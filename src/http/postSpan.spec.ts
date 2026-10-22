import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import express from 'express';
import { httpServerFactory } from '../httpServer.js';
import { spanExporter } from '../testFixtures/spanExporter.js';

describe('mcp.http.post span', () => {
  let port = 0;
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const app = express();
    await httpServerFactory({ name: 'test-server', context: {}, app });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }
    port = address.port;
    cleanup = () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  afterEach(() => {
    spanExporter.reset();
  });

  afterAll(async () => {
    await cleanup();
  });

  const postMcp = (body: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'user-agent': 'test-agent/1.0',
      },
      body,
    });

  const postSpan = () => {
    const span = spanExporter
      .getFinishedSpans()
      .find((finished) => finished.name === 'mcp.http.post');
    if (!span) {
      throw new Error('Expected an mcp.http.post span');
    }
    return span;
  };

  it('records the JSON-RPC method and the user agent', async () => {
    const res = await postMcp(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    );
    expect(res.status).toBe(200);
    await res.body?.cancel();

    const { attributes } = postSpan();
    expect(attributes['mcp.method.name']).toBe('initialize');
    expect(attributes['user_agent.original']).toBe('test-agent/1.0');
  });

  it('records no method when the body is not valid JSON', async () => {
    const res = await postMcp('{not json');
    expect(res.status).toBe(400);
    await res.body?.cancel();

    const { attributes } = postSpan();
    expect(attributes['mcp.method.name']).toBeUndefined();
    expect(attributes['user_agent.original']).toBe('test-agent/1.0');
  });
});
