#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiFactory, PromptFactory } from './types.js';
import { AdditionalSetupArgs, mcpServerFactory } from './mcpServer.js';
import { registerExitHandlers } from './registerExitHandlers.js';

export const stdioServerFactory = async <
  Context extends Record<string, unknown>,
>({
  name,
  version,
  context,
  apiFactories,
  promptFactories = [],
  additionalSetup,
  cleanupFn,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: readonly ApiFactory<Context, any, any>[];
  promptFactories?: readonly PromptFactory<Context, any>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
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
      promptFactories,
      additionalSetup,
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
