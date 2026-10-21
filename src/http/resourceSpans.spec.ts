import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import express from 'express';
import { httpServerFactory } from '../httpServer.js';
import type { ResourceFactory } from '../types.js';

const secretToken = 'secret-access-token';

const noteResourceFactory: ResourceFactory<Record<string, unknown>> = () => ({
  type: 'static',
  name: 'note',
  uri: 'test://note',
  config: { title: 'Note', mimeType: 'text/plain' },
  read: async (uri) => ({
    contents: [{ uri: uri.toString(), text: 'A note' }],
  }),
});

describe('resource spans', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    await cleanup();
    trace.disable();
    await provider.shutdown();
  });

  it('do not record the access token', async () => {
    const app = express();
    // Act as an auth middleware: the SDK gives `req.auth` to the handlers.
    app.use((req, _res, next) => {
      const authInfo: AuthInfo = {
        token: secretToken,
        clientId: 'test-client',
        scopes: [],
      };
      (req as express.Request & { auth?: AuthInfo }).auth = authInfo;
      next();
    });
    await httpServerFactory({
      name: 'test-server',
      context: {},
      resourceFactories: [noteResourceFactory],
      app,
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    cleanup = () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${address.port}/mcp`),
      ),
    );
    await client.readResource({ uri: 'test://note' });
    await client.close();

    const resourceSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'mcp.resource.static.note');
    expect(resourceSpan).toBeDefined();
    expect(JSON.stringify(resourceSpan?.attributes)).not.toContain(secretToken);
  });
});
