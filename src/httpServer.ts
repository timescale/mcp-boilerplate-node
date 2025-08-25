#!/usr/bin/env node
import express, { NextFunction, Request, Response } from 'express';

import { mcpRouterFactory } from './http/mcp.js';
import { apiRouterFactory } from './http/api.js';
import { registerExitHandlers } from './registerExitHandlers.js';
import { ApiFactory } from './types.js';
import { mcpServerFactory } from './mcpServer.js';
import { log } from './logger.js';
import { StatusError } from './StatusError.js';

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
  apiFactories: readonly ApiFactory<Context, any, any>[];
  cleanupFn?: () => void | Promise<void>;
}) => {
  const cleanupFns: (() => void | Promise<void>)[] = cleanupFn
    ? [cleanupFn]
    : [];
  const exitHandler = registerExitHandlers(cleanupFns);

  log.info('Starting HTTP server...');

  const app = express();

  const [mcpRouter, mcpCleanup] = mcpRouterFactory(context, () =>
    mcpServerFactory({
      name,
      version,
      context,
      apiFactories,
    }),
  );
  cleanupFns.push(mcpCleanup);
  app.use('/mcp', mcpRouter);

  const [apiRouter, apiCleanup] = apiRouterFactory(context, apiFactories);
  cleanupFns.push(apiCleanup);
  app.use('/api', apiRouter);

  // Error handler
  app.use(function (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (err instanceof StatusError && err.status < 500) {
      log.info('HTTP error response', {
        message: err.message,
        status: err.status,
      });
    } else {
      log.error('Unexpected HTTP handler error', err);
    }
    res
      .status(err instanceof StatusError ? err.status : 500)
      .json({ error: err.message });
  });

  // Start the server
  const PORT = process.env.PORT || 3001;
  const server = app.listen(PORT, (error?: Error) => {
    if (error) {
      log.error('Error starting HTTP server:', error);
      exitHandler(1);
    } else {
      log.info(`HTTP Server listening on port ${PORT}`);
    }
  });
  cleanupFns.push(async () => {
    await server.close();
  });

  return {
    app,
    server,
    apiRouter,
    mcpRouter,
    registerCleanupFn: (fn: () => Promise<void>) => {
      cleanupFns.push(fn);
    },
  };
};
