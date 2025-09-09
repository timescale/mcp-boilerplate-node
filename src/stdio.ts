#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiFactory } from './types.js';
import { AdditionalSetupArgs, mcpServerFactory } from './mcpServer.js';
import { registerExitHandlers } from './registerExitHandlers.js';

export const stdioServerFactory = async <
  Context extends Record<string, unknown>,
>({
  name,
  version,
  context,
  apiFactories,
  additionalSetup,
  cleanupFn,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: readonly ApiFactory<Context, any, any>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
  cleanupFn?: () => Promise<void>;
}): Promise<void> => {
  try {
    console.error('Starting default (STDIO) server...');
    const transport = new StdioServerTransport();
    const { server } = mcpServerFactory({
      name,
      version,
      context,
      apiFactories,
      additionalSetup,
    });

    await server.connect(transport);

    // Cleanup on exit
    registerExitHandlers([
      async (): Promise<void> => {
        await server.close();
      },
      async (): Promise<void> => {
        await cleanupFn?.();
      },
    ]);
  } catch (error) {
    console.error('Server error:', error);
    process.exit(1);
  }
};
