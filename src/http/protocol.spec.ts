import { afterEach, describe, expect, it } from 'bun:test';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import express from 'express';
import { z } from 'zod';
import { httpServerFactory } from '../httpServer.js';
import type {
  ApiFactory,
  BasePromptFactory,
  ResourceFactory,
} from '../types.js';

const echoInput = { message: z.string() };
const echoOutput = { echoed: z.string() };

const echoFactory: ApiFactory<
  Record<string, unknown>,
  typeof echoInput,
  typeof echoOutput
> = () => ({
  name: 'echo',
  config: {
    title: 'Echo',
    description: 'Return the message',
    inputSchema: echoInput,
    outputSchema: echoOutput,
  },
  fn: async ({ message }) => ({ echoed: message }),
});

const greetingPromptFactory: BasePromptFactory<
  Record<string, unknown>
> = () => ({
  name: 'greeting',
  config: { title: 'Greeting', description: 'Say hello', inputSchema: {} },
  fn: async () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
  }),
});

const noteResourceFactory: ResourceFactory<Record<string, unknown>> = () => ({
  type: 'static',
  name: 'note',
  uri: 'test://note',
  config: { title: 'Note', mimeType: 'text/plain' },
  read: async (uri) => ({
    contents: [{ uri: uri.toString(), text: 'A note' }],
  }),
});

interface StartedServer {
  url: string;
  cleanup: () => Promise<void>;
}

const startServer = async (): Promise<StartedServer> => {
  const app = express();
  await httpServerFactory({
    name: 'test-server',
    context: {},
    apiFactories: [echoFactory],
    promptFactories: [greetingPromptFactory],
    resourceFactories: [noteResourceFactory],
    app,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address');
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    cleanup: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

type Era = 'legacy' | 'modern';

const connect = async (
  url: string,
  era: Era,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> => {
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    era === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  return { client, transport };
};

describe('MCP protocol versions over HTTP', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  const cases: { era: Era; protocolVersion: string }[] = [
    { era: 'modern', protocolVersion: '2026-07-28' },
    { era: 'legacy', protocolVersion: '2025-11-25' },
  ];

  for (const { era, protocolVersion } of cases) {
    it(`serves ${protocolVersion}`, async () => {
      const server = await startServer();
      cleanups.push(server.cleanup);
      const { client, transport } = await connect(server.url, era);
      cleanups.push(() => client.close());

      expect(client.getProtocolEra()).toBe(era);
      expect(client.getNegotiatedProtocolVersion()).toBe(protocolVersion);
      // The server does not create sessions.
      expect(transport.sessionId).toBeUndefined();
      // The server never sends list_changed notifications.
      const capabilities = client.getServerCapabilities();
      expect(capabilities?.tools?.listChanged).toBe(false);
      expect(capabilities?.prompts?.listChanged).toBe(false);
      expect(capabilities?.resources?.listChanged).toBe(false);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['echo']);

      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'hello' },
      });
      expect(result.structuredContent).toEqual({ echoed: 'hello' });

      const prompt = await client.getPrompt({ name: 'greeting' });
      expect(prompt.messages[0]?.content).toEqual({
        type: 'text',
        text: 'Hello',
      });

      const resource = await client.readResource({ uri: 'test://note' });
      expect(resource.contents).toEqual([
        { uri: 'test://note', text: 'A note' },
      ]);
    });
  }

  for (const era of ['modern', 'legacy'] as const) {
    it(`applies query feature flags to ${era} requests`, async () => {
      const server = await startServer();
      cleanups.push(server.cleanup);
      const { client } = await connect(
        `${server.url}?disabled_tools=echo`,
        era,
      );
      cleanups.push(() => client.close());

      const { tools } = await client.listTools();
      expect(tools).toEqual([]);
    });
  }
});
