#!/usr/bin/env node
import type { Server } from 'node:http';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import bodyParser from 'body-parser';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
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
  /**
   * DNS rebinding protection via Host header validation. DNS rebinding
   * attacks can bypass the browser same-origin policy by pointing a domain at
   * a localhost address, letting a malicious website reach a local server.
   * Validating the Host header against an allow-list prevents this. This is
   * especially important for servers without authorization or HTTPS.
   *
   * Protection is **disabled by default** (opt-in). This library is primarily
   * used by hosted MCP servers served on arbitrary public hostnames, where a
   * Host allow-list would reject legitimate traffic and the DNS rebinding
   * threat (a victim's browser reaching an unauthenticated `localhost`
   * server) does not apply. Localhost/development servers should opt in.
   *
   * The `MCP_ALLOWED_HOSTS` environment variable (a comma-separated list of
   * hostnames) is consulted when this option is omitted or `true`, and is
   * ignored when an explicit `string[]` or `false` is passed:
   *
   * - omitted (default): disabled, unless `MCP_ALLOWED_HOSTS` is set — in
   *   which case protection is enabled using that allow-list.
   * - `true`: enabled. Uses the `MCP_ALLOWED_HOSTS` allow-list when set,
   *   otherwise defaults to localhost (`localhost`, `127.0.0.1`, `[::1]`).
   * - `string[]`: enabled, validating against exactly these hostnames
   *   (`MCP_ALLOWED_HOSTS` is ignored). Hostnames only, without ports; for
   *   IPv6, use bracket notation (e.g. `"[::1]"`).
   * - `false`: disabled. Always wins, even if `MCP_ALLOWED_HOSTS` is set.
   */
  dnsRebindingProtection?: boolean | readonly string[];
  /**
   * Network interface (hostname or IP address) to bind the HTTP server to.
   * Forwarded to `app.listen()`. For example, `"127.0.0.1"` restricts the
   * server to loopback so it is unreachable from other machines — a strong,
   * OS-level defense for localhost/development servers.
   *
   * Defaults to the `HOST` environment variable, or undefined (bind all
   * available interfaces) when unset. Ignored when an external `app` is
   * provided, since the caller owns the server lifecycle.
   */
  host?: string;
}

const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const hostnamesFromEnv = (): string[] | null => {
  const fromEnv = process.env.MCP_ALLOWED_HOSTS?.split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  return fromEnv?.length ? fromEnv : null;
};

/**
 * Resolves the Host header allow-list for DNS rebinding protection.
 * Returns `null` when protection is disabled. Protection is disabled by
 * default (opt-in); it is enabled by passing `true`, passing an explicit
 * allow-list, or setting the `MCP_ALLOWED_HOSTS` environment variable.
 */
const resolveAllowedHostnames = (
  dnsRebindingProtection: boolean | readonly string[] | undefined,
): string[] | null => {
  // Explicit custom allow-list.
  if (Array.isArray(dnsRebindingProtection)) {
    return [...dnsRebindingProtection];
  }
  // Explicit opt-out wins over the env var.
  if (dnsRebindingProtection === false) {
    return null;
  }
  // Explicitly enabled: use the env-configured allow-list when present,
  // otherwise fall back to localhost-only.
  if (dnsRebindingProtection === true) {
    return hostnamesFromEnv() ?? [...LOCALHOST_HOSTNAMES];
  }
  // Disabled by default (omitted), unless the env var opts in.
  return hostnamesFromEnv();
};

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
  dnsRebindingProtection,
  host = process.env.HOST,
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

  // DNS rebinding protection: validate the Host header against an allow-list.
  // Scoped to the MCP and API mount paths so callers providing an external
  // app keep full control over their other routes.
  const allowedHostnames = resolveAllowedHostnames(dnsRebindingProtection);
  const hostValidation: RequestHandler | null = allowedHostnames
    ? hostHeaderValidation(allowedHostnames)
    : null;
  if (allowedHostnames) {
    log.info('DNS rebinding protection enabled', { allowedHostnames });
  }

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
  if (hostValidation) {
    app.use(mcpPath, hostValidation);
  }
  app.use(mcpPath, mcpRouter);

  const [apiRouter, apiCleanup] = await apiRouterFactory(context, apiFactories);
  cleanupFns.push(apiCleanup);
  if (hostValidation) {
    app.use(apiPath, hostValidation);
  }
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
  const onListen = async (error?: Error): Promise<void> => {
    if (error) {
      log.error('Error starting HTTP server:', error);
      exitHandler(1);
    } else {
      log.info(
        `HTTP Server listening on ${host ? `${host}:${PORT}` : `port ${PORT}`}`,
      );
      if (inspector) {
        log.info(
          `🌐 MCP inspector running at http://localhost:${PORT}/inspector`,
        );
      }
    }
  };
  // `app.listen` overloads differ by whether a host is provided; calling with
  // an explicit `undefined` host binds all interfaces (Node's default).
  const server = host
    ? ownApp.listen(Number(PORT), host, onListen)
    : ownApp.listen(PORT, onListen);
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
