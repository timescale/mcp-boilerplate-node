import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import { RouterFactoryResult } from '../types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const mcpRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  createServer: (context: Context) => { server: McpServer },
): RouterFactoryResult => {
  const router = Router();

  const transports: Map<string, StreamableHTTPServerTransport> = new Map<
    string,
    StreamableHTTPServerTransport
  >();

  router.post('/', async (req: Request, res: Response) => {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      // Reuse existing transport
      transport = transports.get(sessionId)!;
    } else if (!sessionId) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          // Store the transport by session ID when session is initialized
          // This avoids race conditions where requests might come in before the session is stored
          console.error(`Session initialized with ID: ${sessionId}`);
          transports.set(sessionId, transport);
        },
        onsessionclosed: (sessionId: string) => {
          if (sessionId && transports.has(sessionId)) {
            console.error(
              `Transport closed for session ${sessionId}, removing from transports map`,
            );
            transports.delete(sessionId);
          }
        },
      });

      // Connect the transport to the MCP server BEFORE handling the request
      // so responses can flow back through the same transport
      const { server } = createServer(context);
      await server.connect(transport);
    } else {
      // Invalid request - no session ID or not initialization request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: req?.body?.id,
      });
      return;
    }

    // Handle the request with existing transport - no need to reconnect
    // The existing transport is already connected to the server
    await transport.handleRequest(req, res);
  });

  // Reusable handler for GET and DELETE requests
  const handleSessionRequest = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : null;
    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    await transport.handleRequest(req, res);
  };

  // Handle GET requests for server-to-client notifications via SSE
  router.get('/', handleSessionRequest);

  // Handle DELETE requests for session termination
  router.delete('/', handleSessionRequest);

  const cleanup = async () => {
    // Close all active transports to properly clean up resources
    for (const sessionId in transports) {
      try {
        console.error(`Closing transport for session ${sessionId}`);
        await transports.get(sessionId)!.close();
        transports.delete(sessionId);
      } catch (error) {
        console.error(
          `Error closing transport for session ${sessionId}:`,
          error,
        );
      }
    }
  };

  return [router, cleanup];
};
