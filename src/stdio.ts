#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiFactory } from './types.js';
import { mcpServerFactory } from './mcpServer.js';
import { registerExitHandlers } from './registerExitHandlers.js';

export const stdioServerFactory = async <
  Context extends Record<string, unknown>,
>({
  name,
  version,
  context,
  apiFactories,
  cleanupFn,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: ApiFactory<Context, any, any>[];
  cleanupFn?: () => Promise<void>;
}) => {
  try {
    console.error('Starting default (STDIO) server...');
    const transport = new StdioServerTransport();
    const { server } = mcpServerFactory({
      name,
      version,
      context,
      apiFactories,
    });

    await server.connect(transport);

    // Cleanup on exit
    registerExitHandlers([
      async () => {
        await server.close();
      },
      async () => cleanupFn?.(),
    ]);
  } catch (error) {
    console.error('Server error:', error);
    process.exit(1);
  }
};
