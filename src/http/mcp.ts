import { AsyncLocalStorage } from 'node:async_hooks';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { ATTR_HTTP_RESPONSE_STATUS_CODE } from '@opentelemetry/semantic-conventions';
import escapeHtml from 'escape-html';
import { type Request, type Response, Router } from 'express';
import { log } from '../logger.js';
import type {
  McpFeatureFlags,
  ParsedQs,
  RouterFactoryResult,
} from '../types.js';

const name = process.env.OTEL_SERVICE_NAME;
const tracer = trace.getTracer(name ? `${name}.router.mcp` : 'router.mcp');

/** Take the first value, because a header can repeat. */
const firstHeaderValue = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

export const mcpRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  createServer: (
    context: Context,
    featureFlags: McpFeatureFlags,
  ) => Promise<{ server: McpServer }>,
  {
    name,
    inspector = false,
  }: {
    name?: string;
    inspector?: boolean;
  } = {},
): RouterFactoryResult => {
  const router = Router();

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

  // createMcpHandler calls the server factory itself, so the feature flags
  // of the current HTTP request go to the factory through this storage.
  const requestFeatureFlags = new AsyncLocalStorage<McpFeatureFlags>();

  // This handler creates one server for each request. It serves the
  // 2026-07-28 protocol, and the 2025 protocol without sessions.
  const perRequestHandler = createMcpHandler(
    async () => {
      const featureFlags = requestFeatureFlags.getStore();
      if (!featureFlags) {
        throw new Error('MCP server factory called outside of a request');
      }
      const { server } = await createServer(context, featureFlags);
      return server;
    },
    {
      onerror: (error) => log.error('Error handling MCP request:', error),
    },
  );
  const handlePerRequest = toNodeHandler(perRequestHandler, {
    onerror: (error) => log.error('Error handling MCP request:', error),
  });

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
          // When a body parser already read the body, use it. Otherwise
          // the handler reads the body from the request stream.
          await requestFeatureFlags.run(parseFeatureFlags(req), () =>
            handlePerRequest(req, res, req.body),
          );
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

  // Without sessions, the server does not use GET or DELETE requests.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  };

  // Serve a documentation page to browsers
  router.get('/', (req, res) => {
    if (req.accepts('html')) {
      // The client controls these values (directly, or through a proxy that
      // forwards them), so they must be escaped before they go into the HTML.
      const proto =
        firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol;
      const host =
        firstHeaderValue(req.headers['x-forwarded-host']) || req.get('host');
      const path =
        firstHeaderValue(req.headers['x-original-request-uri']) ||
        firstHeaderValue(req.headers['x-original-uri']) ||
        req.originalUrl;
      const fullUrl = `${proto}://${host}${path}`;
      res.send(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <h2>Model Context Protocol (MCP) Server</h2>
  <p>This endpoint is used for MCP communication. Please use an MCP-compatible client to interact with this server.</p>
  ${
    inspector
      ? `
  <h3>Inspector</h3>
  <p>You can use the <a href="/inspector?server=${escapeHtml(encodeURIComponent(fullUrl))}">MCP Inspector</a> for testing purposes.</p>`
      : ''
  }
  <h3>Claude Code</h3>
  <p>To connect to this MCP server using Claude Code, run the following command in your terminal:</p>
  <pre><code>claude mcp add --transport http ${escapeHtml(name || req.get('host'))} ${escapeHtml(fullUrl)}</code></pre>
</body>
</html>`);
      return;
    }
    methodNotAllowed(req, res);
  });

  router.delete('/', methodNotAllowed);

  const cleanup = async (): Promise<void> => {
    await perRequestHandler.close();
  };

  return [router, cleanup];
};
