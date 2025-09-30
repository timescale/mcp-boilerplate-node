import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import getRawBody from 'raw-body';
import { RouterFactoryResult } from '../types.js';
import { log } from '../logger.js';

export const mcpRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  createServer: (context: Context) => { server: McpServer },
  {
    name,
    stateful = true,
  }: {
    name?: string;
    stateful?: boolean;
  } = {},
): RouterFactoryResult => {
  const router = Router();

  const transports: Map<string, StreamableHTTPServerTransport> = new Map<
    string,
    StreamableHTTPServerTransport
  >();

  const handleStatelessRequest = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { server } = createServer(context);
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
      if (!transports.has(sessionId)) {
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
      transport = transports.get(sessionId)!;
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

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: (): string => randomUUID(),
        onsessioninitialized: (sessionId: string): void => {
          log.info(`Session initialized with ID: ${sessionId}`);
          transports.set(sessionId, transport);
        },
        onsessionclosed: (sessionId: string): void => {
          if (sessionId && transports.has(sessionId)) {
            log.info(
              `Transport closed for session ${sessionId}, removing from transports map`,
            );
            transports.delete(sessionId);
          }
        },
      });

      const { server } = createServer(context);
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, body);
  };

  router.post('/', async (req: Request, res: Response) => {
    try {
      await (stateful
        ? handleStatefulRequest(req, res)
        : handleStatelessRequest(req, res));
    } catch (error) {
      log.error('Error handling MCP request:', error as Error);
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
    }
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

    await transports.get(sessionId)!.handleRequest(req, res);
  };

  // Handle GET requests for server-to-client notifications via SSE
  router.get('/', (req, res) => {
    if (req.accepts('html')) {
      res.send(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
</head>
<body>
  <h1>${name}</h1>
  <h2>Model Context Protocol (MCP) Server</h2>
  <p>This endpoint is used for MCP communication. Please use an MCP-compatible client to interact with this server.</p>

  <h3>Claude Code</h3>
  <p>To connect to this MCP server using Claude Code, run the following command in your terminal:</p>
  <pre><code>claude mcp add --transport http ${name || req.get('host')} ${req.protocol}://${req.get('host')}${req.originalUrl}</code></pre>
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
        await transports.get(sessionId)!.close();
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
