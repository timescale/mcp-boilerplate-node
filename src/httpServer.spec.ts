import { afterEach, describe, expect, it } from 'bun:test';
import express from 'express';
import { httpServerFactory } from './httpServer.js';

interface StartedServer {
  port: number;
  cleanup: () => Promise<void>;
}

const startServer = async (
  dnsRebindingProtection: boolean | readonly string[] | undefined,
): Promise<StartedServer> => {
  const app = express();
  await httpServerFactory({
    name: 'test-server',
    context: {},
    app,
    dnsRebindingProtection,
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }

  return {
    port: address.port,
    cleanup: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
};

const postMcp = (port: number, host: string | undefined): Promise<Response> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (host !== undefined) {
    headers.host = host;
  }
  // Use 127.0.0.1 so the request reaches the server, while overriding the
  // Host header to exercise validation.
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }),
  });
};

describe('httpServerFactory DNS rebinding protection', () => {
  const started: StartedServer[] = [];

  afterEach(async () => {
    while (started.length > 0) {
      const s = started.pop();
      await s?.cleanup();
    }
  });

  const track = (s: StartedServer): StartedServer => {
    started.push(s);
    return s;
  };

  it('rejects disallowed Host headers when protection is enabled', async () => {
    const { port } = track(await startServer(true));

    const res = await postMcp(port, 'evil.example.com');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain('Invalid Host');
  });

  it('is disabled by default when the option is omitted', async () => {
    const { port } = track(await startServer(undefined));

    const res = await postMcp(port, 'evil.example.com');
    expect(res.status).not.toBe(403);
  });

  it('allows localhost Host headers when protection is enabled', async () => {
    const { port } = track(await startServer(true));

    const res = await postMcp(port, `127.0.0.1:${port}`);
    // Not a 403 — the request passes Host validation and reaches the MCP
    // handler (which then negotiates the session normally).
    expect(res.status).not.toBe(403);
  });

  it('allows any Host header when protection is disabled', async () => {
    const { port } = track(await startServer(false));

    const res = await postMcp(port, 'evil.example.com');
    expect(res.status).not.toBe(403);
  });

  it('validates against a custom allow-list', async () => {
    const { port } = track(await startServer(['mcp.internal']));

    const allowed = await postMcp(port, 'mcp.internal');
    expect(allowed.status).not.toBe(403);

    const denied = await postMcp(port, 'localhost');
    expect(denied.status).toBe(403);
  });
});

describe('httpServerFactory interface binding', () => {
  it('binds to the requested host', async () => {
    const prevPort = process.env.PORT;
    process.env.PORT = '0';
    try {
      const { server } = await httpServerFactory({
        name: 'test-server',
        context: {},
        host: '127.0.0.1',
      });
      if (!server) {
        throw new Error('Expected own server');
      }
      try {
        if (!server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
          });
        }
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Expected a TCP server address');
        }
        expect(address.address).toBe('127.0.0.1');
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
      }
    } finally {
      if (prevPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = prevPort;
      }
    }
  });
});
