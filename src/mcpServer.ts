import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiFactory } from './types.js';

export const mcpServerFactory = <Context extends Record<string, unknown>>({
  name,
  version = '1.0.0',
  context,
  apiFactories,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: readonly ApiFactory<Context, any, any>[];
}): { server: McpServer } => {
  const server = new McpServer(
    {
      name,
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  for (const factory of apiFactories) {
    const tool = factory(context);
    server.registerTool(tool.name, tool.config as any, async (args) => {
      try {
        const result = await tool.fn(args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        console.error('Error invoking tool:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${(error as Error).message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  return { server };
};
