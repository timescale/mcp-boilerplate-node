#!/usr/bin/env node
import express, { NextFunction, Request, Response } from 'express';

import { mcpRouterFactory } from './http/mcp.js';
import { apiRouterFactory } from './http/api.js';
import { registerExitHandlers } from './registerExitHandlers.js';
import { ApiFactory, PromptFactory, ResourceFactory } from './types.js';
import { AdditionalSetupArgs, mcpServerFactory } from './mcpServer.js';
import { log } from './logger.js';
import { StatusError } from './StatusError.js';
import { Server } from 'node:http';

export const httpServerFactory = <Context extends Record<string, unknown>>({
  name,
  version,
  context,
  apiFactories = [],
  promptFactories,
  resourceFactories,
  additionalSetup,
  cleanupFn,
  stateful = true,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories?: readonly ApiFactory<Context, any, any>[];
  promptFactories?: readonly PromptFactory<Context, any>[];
  resourceFactories?: readonly ResourceFactory<Context>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
  cleanupFn?: () => void | Promise<void>;
  stateful?: boolean;
}): {
  app: express.Express;
  server: Server;
  apiRouter: express.Router;
  mcpRouter: express.Router;
  registerCleanupFn: (fn: () => Promise<void>) => void;
} => {
  const cleanupFns: (() => void | Promise<void>)[] = cleanupFn
    ? [cleanupFn]
    : [];
  const exitHandler = registerExitHandlers(cleanupFns);

  log.info('Starting HTTP server...');

  const app = express();
  app.enable('trust proxy');

  const [mcpRouter, mcpCleanup] = mcpRouterFactory(
    context,
    (context, featureFlags) =>
      mcpServerFactory({
        name,
        version,
        context,
        apiFactories,
        promptFactories,
        resourceFactories,
        additionalSetup,
        featureFlags,
      }),
    { name, stateful },
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
    _next: NextFunction,
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
    registerCleanupFn: (fn: () => Promise<void>): void => {
      cleanupFns.push(fn);
    },
  };
};
