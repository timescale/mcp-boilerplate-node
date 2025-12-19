#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import { type AdditionalSetupArgs, mcpServerFactory } from './mcpServer.js';
import { registerExitHandlers } from './registerExitHandlers.js';
import type { ApiFactory, PromptFactory, ResourceFactory } from './types.js';

export const stdioServerFactory = async <
  Context extends Record<string, unknown>,
>({
  name,
  version,
  context,
  apiFactories,
  promptFactories,
  resourceFactories,
  additionalSetup,
  cleanupFn,
  instructions,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories?: readonly ApiFactory<Context, ZodRawShape, ZodRawShape>[];
  promptFactories?: readonly PromptFactory<Context, ZodRawShape>[];
  resourceFactories?: readonly ResourceFactory<Context>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
  cleanupFn?: () => Promise<void>;
  instructions?: string;
}): Promise<void> => {
  try {
    console.error('Starting default (STDIO) server...');
    const transport = new StdioServerTransport();
    const { server } = mcpServerFactory({
      name,
      version,
      context,
      apiFactories,
      promptFactories,
      resourceFactories,
      additionalSetup,
      instructions,
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
