#!/usr/bin/env node
import type { Server } from 'node:http';
import bodyParser from 'body-parser';
import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
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
   * When provided, mount routers on this app/router instead of creating a new
   * one. The caller owns the server lifecycle — `httpServerFactory` will not
   * call `app.listen()`. The returned `server` will be `null`.
   */
  app?: Router;
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
  app: Router;
  /** `null` when an external `app` was provided (caller owns the server). */
  server: Server | null;
  apiRouter: express.Router;
  mcpRouter: express.Router;
  registerCleanupFn: (fn: () => Promise<void>) => void;
}

export const httpServerFactory = async <
  Context extends Record<string, unknown>,
>({
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
}: HttpServerOptions<Context>): Promise<HttpServerResult> => {
  const cleanupFns: (() => void | Promise<void>)[] = cleanupFn
    ? [cleanupFn]
    : [];
  const exitHandler = registerExitHandlers(cleanupFns);

  let app: Router;
  let ownApp: express.Express | undefined;
  if (externalApp) {
    app = externalApp;
  } else {
    ownApp = express();
    ownApp.enable('trust proxy');
    app = ownApp;
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

  if (inspector && 'listen' in app) {
    const expressApp = app as express.Express;
    process.env.MCP_USE_ANONYMIZED_TELEMETRY = 'false';
    import('@mcp-use/inspector')
      .then(({ mountInspector }) => {
        expressApp.use(bodyParser.json());
        mountInspector(expressApp, {
          autoConnectUrl:
            process.env.MCP_PUBLIC_URL ?? `http://localhost:${PORT}/mcp`,
        });
      })
      .catch(log.error);
  }

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

  // Start the server (ownApp is guaranteed to exist here — we returned early for external apps)
  if (!ownApp) throw new Error('Expected own Express app');
  const server = ownApp.listen(PORT, async (error?: Error) => {
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
