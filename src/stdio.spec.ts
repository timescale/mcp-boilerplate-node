import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const fixturePath = fileURLToPath(
  new URL('./testFixtures/stdioServer.ts', import.meta.url),
);

describe('MCP protocol versions over stdio', () => {
  const cases = [
    { era: 'modern', protocolVersion: '2026-07-28' },
    { era: 'legacy', protocolVersion: '2025-11-25' },
  ] as const;

  for (const { era, protocolVersion } of cases) {
    it(`serves ${protocolVersion}`, async () => {
      const client = new Client(
        { name: 'test-client', version: '1.0.0' },
        era === 'modern'
          ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
          : undefined,
      );
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fixturePath],
          stderr: 'ignore',
        }),
      );
      try {
        expect(client.getProtocolEra()).toBe(era);
        expect(client.getNegotiatedProtocolVersion()).toBe(protocolVersion);

        const result = await client.callTool({
          name: 'echo',
          arguments: { message: 'hello' },
        });
        expect(result.structuredContent).toEqual({ echoed: 'hello' });
      } finally {
        await client.close();
      }
    });
  }
});
