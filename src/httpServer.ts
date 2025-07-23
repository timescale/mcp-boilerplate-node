#!/usr/bin/env node
import express, { NextFunction, Request, Response } from 'express';

import { mcpRouterFactory } from './http/mcp.js';
import { apiRouterFactory } from './http/api.js';
import { registerExitHandlers } from './registerExitHandlers.js';
import { ApiFactory } from './types.js';
import { mcpServerFactory } from './mcpServer.js';

export const httpServerFactory = <Context extends Record<string, unknown>>({
  name,
  version,
  context,
  apiFactories,
  cleanupFn,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: ApiFactory<Context, any, any>[];
  cleanupFn?: () => Promise<void>;
}) => {
  const exitHandler = registerExitHandlers([
    async () => {
      await server.close();
    },
    async () => cleanupFn?.(),
    async () => mcpCleanup?.(),
    async () => apiCleanup?.(),
  ]);

  console.error('Starting HTTP server...');

  const app = express();

  const [mcpRouter, mcpCleanup] = mcpRouterFactory(context, () =>
    mcpServerFactory({
      name,
      version,
      context,
      apiFactories,
    }),
  );
  app.use('/mcp', mcpRouter);

  const [apiRouter, apiCleanup] = apiRouterFactory(context, apiFactories);
  app.use('/api', apiRouter);

  // Error handler
  app.use(function (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    console.log('Received error:', err.message);
    res.status(500).send(err.message);
  });

  // Start the server
  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, (error?: Error) => {
    if (error) {
      console.error('Error starting HTTP server:', error);
      exitHandler(1);
    } else {
      console.error(`HTTP Server listening on port ${PORT}`);
    }
  });

  return {
    app,
    server,
  };
};
