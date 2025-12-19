import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from '@opentelemetry/semantic-conventions';
import { type Request, type Response, Router } from 'express';
import getRawBody from 'raw-body';
import { log } from '../logger.js';
import type {
  McpFeatureFlags,
  ParsedQs,
  RouterFactoryResult,
} from '../types.js';

const name = process.env.OTEL_SERVICE_NAME;
const tracer = trace.getTracer(name ? `${name}.router.mcp` : 'router.mcp');

export const mcpRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  createServer: (
    context: Context,
    featureFlags: McpFeatureFlags,
  ) => { server: McpServer },
  {
    name,
    stateful = true,
    inspector = false,
  }: {
    name?: string;
    stateful?: boolean;
    inspector?: boolean;
  } = {},
): RouterFactoryResult => {
  const router = Router();

  const transports: Map<string, StreamableHTTPServerTransport> = new Map<
    string,
    StreamableHTTPServerTransport
  >();

  const sessionFeatureFlags: Map<string, McpFeatureFlags> = new Map<
    string,
    McpFeatureFlags
  >();

  const toSet = (flag: ParsedQs[string]): Set<string> | null =>
    flag
      ? Array.isArray(flag)
        ? new Set(flag as string[])
        : typeof flag === 'string'
          ? new Set(flag.split(',').map((s) => s.trim()))
          : null
      : null;

  const parseFeatureFlags = (req: Request): McpFeatureFlags => ({
    prompts: req.query.prompts !== 'false' && req.query.prompts !== '0',
    enabledPrompts: toSet(req.query.enabled_prompts),
    disabledPrompts: toSet(req.query.disabled_prompts),
    resources: req.query.resources !== 'false' && req.query.resources !== '0',
    enabledResources: toSet(req.query.enabled_resources),
    disabledResources: toSet(req.query.disabled_resources),
    tools: req.query.tools !== 'false' && req.query.tools !== '0',
    enabledTools: toSet(req.query.enabled_tools),
    disabledTools: toSet(req.query.disabled_tools),
    query: req.query,
  });

  const handleStatelessRequest = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const featureFlags = parseFeatureFlags(req);
    const { server } = createServer(context, featureFlags);
    const transport: StreamableHTTPServerTransport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  const handleStatefulRequest = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    let body = req.body;

    if (sessionId) {
      const t = transports.get(sessionId);
      if (!t) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Not Found: No session found for that ID',
          },
          id: sessionId,
        });
        return;
      }
      transport = t;
    } else {
      if (!body) {
        body = await getRawBody(req, {
          limit: '4mb',
          encoding: 'utf-8',
        });
        body = JSON.parse(body.toString());
      }
      if (!isInitializeRequest(body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Invalid request: Missing session ID',
          },
          id: null,
        });
        return;
      }

      const featureFlags = parseFeatureFlags(req);

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: (): string => randomUUID(),
        onsessioninitialized: (sessionId: string): void => {
          log.info(`Session initialized with ID: ${sessionId}`);
          transports.set(sessionId, transport);
          sessionFeatureFlags.set(sessionId, featureFlags);
        },
        onsessionclosed: (sessionId: string): void => {
          if (sessionId && transports.has(sessionId)) {
            log.info(
              `Transport closed for session ${sessionId}, removing from transports map`,
            );
            transports.delete(sessionId);
            sessionFeatureFlags.delete(sessionId);
          }
        },
      });

      const { server } = createServer(context, featureFlags);
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, body);
  };

  router.post('/', async (req: Request, res: Response) => {
    let traceContext = otelContext.active();
    if (req.headers.traceparent) {
      // Some MCP clients (e.g. pydantic) pass the parent trace context
      traceContext = propagation.extract(traceContext, {
        traceparent: req.headers.traceparent,
      });
    }
    await tracer.startActiveSpan(
      'mcp.http.post',
      { kind: SpanKind.SERVER },
      traceContext,
      async (span) => {
        try {
          await (stateful
            ? handleStatefulRequest(req, res)
            : handleStatelessRequest(req, res));
          span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, res.statusCode);
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          log.error('Error handling MCP request:', error as Error);
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          });
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            });
          }
        } finally {
          span.end();
        }
      },
    );
  });

  // Reusable handler for GET and DELETE requests
  const handleSessionRequest = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!stateful) {
      res.status(405).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed.',
        },
        id: null,
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid request: Missing session ID',
        },
        id: null,
      });
      return;
    }

    if (!transports.get(sessionId)) {
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Not Found: No session found for that ID',
        },
        id: sessionId,
      });
      return;
    }

    await transports.get(sessionId)?.handleRequest(req, res);
  };

  // Handle GET requests for server-to-client notifications via SSE
  router.get('/', (req, res) => {
    if (req.accepts('html')) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const path =
        req.headers['x-original-request-uri'] ||
        req.headers['x-original-uri'] ||
        req.originalUrl;
      const fullUrl = `${proto}://${host}${path}`;
      res.send(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
</head>
<body>
  <h1>${name}</h1>
  <h2>Model Context Protocol (MCP) Server</h2>
  <p>This endpoint is used for MCP communication. Please use an MCP-compatible client to interact with this server.</p>
  ${
    inspector
      ? `
  <h3>Inspector</h3>
  <p>You can use the <a href="/inspector?server=${encodeURIComponent(fullUrl)}">MCP Inspector</a> for testing purposes.</p>`
      : ''
  }
  <h3>Claude Code</h3>
  <p>To connect to this MCP server using Claude Code, run the following command in your terminal:</p>
  <pre><code>claude mcp add --transport http ${name || req.get('host')} ${fullUrl}</code></pre>
</body>
</html>`);
      return;
    }
    handleSessionRequest(req, res);
  });

  // Handle DELETE requests for session termination
  router.delete('/', handleSessionRequest);

  const cleanup = async (): Promise<void> => {
    // Close all active transports to properly clean up resources
    for (const sessionId in transports) {
      try {
        log.info(`Closing transport for session ${sessionId}`);
        await transports.get(sessionId)?.close();
        transports.delete(sessionId);
      } catch (error) {
        log.error(
          `Error closing transport for session ${sessionId}:`,
          error as Error,
        );
      }
    }
  };

  return [router, cleanup];
};
