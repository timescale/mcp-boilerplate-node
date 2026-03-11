#!/usr/bin/env node
import type { Server } from 'node:http';
import bodyParser from 'body-parser';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { apiRouterFactory } from './http/api.js';
import { mcpRouterFactory } from './http/mcp.js';
import { log } from './logger.js';
import { type AdditionalSetupArgs, mcpServerFactory } from './mcpServer.js';
import { registerExitHandlers } from './registerExitHandlers.js';
import { StatusError } from './StatusError.js';
import type {
  BaseApiFactory,
  BasePromptFactory,
  ResourceFactory,
} from './types.js';

interface HttpServerOptions<Context extends Record<string, unknown>> {
  name: string;
  version?: string;
  context: Context;
  apiFactories?: readonly BaseApiFactory<Context>[];
  promptFactories?: readonly BasePromptFactory<Context>[];
  resourceFactories?: readonly ResourceFactory<Context>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
  cleanupFn?: () => void | Promise<void>;
  stateful?: boolean;
  instructions?: string;
  /**
   * When provided, mount routers on this Express app instead of creating a new
   * one. The caller owns the server lifecycle — `httpServerFactory` will not
   * call `app.listen()`. The returned `server` will be `null`.
   */
  app?: express.Express;
  /**
   * Path to mount the MCP router at. Defaults to `"/mcp"`.
   */
  mcpPath?: string;
  /**
   * Path to mount the API router at. Defaults to `"/api"`.
   */
  apiPath?: string;
}

interface HttpServerResult {
  app: express.Express;
  /** `null` when an external `app` was provided (caller owns the server). */
  server: Server | null;
  apiRouter: express.Router;
  mcpRouter: express.Router;
  registerCleanupFn: (fn: () => Promise<void>) => void;
}

export const httpServerFactory = async <
  Context extends Record<string, unknown>,
>(
  opts: HttpServerOptions<Context>,
): Promise<HttpServerResult> => {
  const {
    name,
    version,
    context,
    apiFactories = [],
    promptFactories,
    resourceFactories,
    additionalSetup,
    cleanupFn,
    stateful = true,
    instructions,
    app: externalApp,
    mcpPath = '/mcp',
    apiPath = '/api',
  } = opts;

  const cleanupFns: (() => void | Promise<void>)[] = cleanupFn
    ? [cleanupFn]
    : [];
  const exitHandler = registerExitHandlers(cleanupFns);

  const app = externalApp ?? express();
  if (!externalApp) {
    app.enable('trust proxy');
  }

  const PORT = process.env.PORT || 3001;

  const inspector =
    process.env.NODE_ENV !== 'production' ||
    ['1', 'true'].includes(process.env.ENABLE_INSPECTOR ?? '0');

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
        instructions,
      }),
    { name, stateful, inspector },
  );
  cleanupFns.push(mcpCleanup);
  app.use(mcpPath, mcpRouter);

  const [apiRouter, apiCleanup] = await apiRouterFactory(context, apiFactories);
  cleanupFns.push(apiCleanup);
  app.use(apiPath, apiRouter);

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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

  // When an external app is provided, the caller owns the server lifecycle.
  if (externalApp) {
    return {
      app,
      server: null,
      apiRouter,
      mcpRouter,
      registerCleanupFn: (fn: () => Promise<void>): void => {
        cleanupFns.push(fn);
      },
    };
  }

  if (inspector) {
    process.env.MCP_USE_ANONYMIZED_TELEMETRY = 'false';
    import('@mcp-use/inspector')
      .then(({ mountInspector }) => {
        app.use(bodyParser.json());
        mountInspector(app, {
          autoConnectUrl:
            process.env.MCP_PUBLIC_URL ?? `http://localhost:${PORT}/mcp`,
        });
      })
      .catch(log.error);
  }

  // Start the server
  const server = app.listen(PORT, async (error?: Error) => {
    if (error) {
      log.error('Error starting HTTP server:', error);
      exitHandler(1);
    } else {
      log.info(`HTTP Server listening on port ${PORT}`);
      if (inspector) {
        log.info(
          `🌐 MCP inspector running at http://localhost:${PORT}/inspector`,
        );
      }
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
