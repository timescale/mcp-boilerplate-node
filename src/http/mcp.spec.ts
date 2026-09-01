import { afterEach, describe, expect, it } from 'bun:test';
import express from 'express';
import { httpServerFactory } from '../httpServer.js';

interface StartedServer {
  port: number;
  cleanup: () => Promise<void>;
}

const startServer = async (): Promise<StartedServer> => {
  const app = express();
  app.enable('trust proxy');
  await httpServerFactory({
    name: 'test-server',
    context: {},
    app,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }

  return {
    port: address.port,
    cleanup: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

const getDocsPage = (
  port: number,
  headers: Record<string, string>,
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    headers: { accept: 'text/html', ...headers },
  });

describe('mcp docs page', () => {
  const started: StartedServer[] = [];

  afterEach(async () => {
    while (started.length > 0) {
      await started.pop()?.cleanup();
    }
  });

  const track = (s: StartedServer): StartedServer => {
    started.push(s);
    return s;
  };

  it('escapes the forwarded host', async () => {
    const { port } = track(await startServer());

    const res = await getDocsPage(port, {
      'x-forwarded-host': 'INJECTED</code></pre><img src=x onerror=alert(1)>',
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('<img src=x');
    expect(body).not.toContain('</code></pre><');
    expect(body).toContain(
      'INJECTED&lt;/code&gt;&lt;/pre&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('escapes the original request uri', async () => {
    const { port } = track(await startServer());

    const res = await getDocsPage(port, {
      'x-original-request-uri': '/mcp"><script>alert(1)</script>',
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain(
      '/mcp&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes the forwarded proto', async () => {
    const { port } = track(await startServer());

    const res = await getDocsPage(port, {
      'x-forwarded-proto': '<script>alert(1)</script>',
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;://');
  });
});
