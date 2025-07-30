import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiFactory } from './types.js';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const name = process.env.OTEL_SERVICE_NAME;
const tracer = trace.getTracer(name ? `${name}.mcpServer` : 'mcpServer');

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
    server.registerTool(tool.name, tool.config as any, async (args) =>
      tracer.startActiveSpan(
        `mcp.tool.${tool.name}`,
        async (span): Promise<CallToolResult> => {
          span.setAttribute('mcp.tool.args', JSON.stringify(args));
          try {
            const result = await tool.fn(args as any);
            span.setStatus({ code: SpanStatusCode.OK });
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
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${(error as Error).message || 'Unknown error'}`,
                },
              ],
              isError: true,
            };
          } finally {
            span.end();
          }
        },
      ),
    );
  }

  return { server };
};
