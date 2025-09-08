import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiFactory } from './types.js';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from './logger.js';

const name = process.env.OTEL_SERVICE_NAME;
const tracer = trace.getTracer(name ? `${name}.mcpServer` : 'mcpServer');

const enabledTools = process.env.MCP_ENABLED_TOOLS
  ? new Set(process.env.MCP_ENABLED_TOOLS.split(',').map((s) => s.trim()))
  : null;
const disabledTools = process.env.MCP_DISABLED_TOOLS
  ? new Set(process.env.MCP_DISABLED_TOOLS.split(',').map((s) => s.trim()))
  : null;

export interface AdditionalSetupArgs<Context extends Record<string, unknown>> {
  context: Context;
  server: McpServer;
}

export const mcpServerFactory = <Context extends Record<string, unknown>>({
  name,
  version = '1.0.0',
  context,
  apiFactories,
  additionalSetup,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: readonly ApiFactory<Context, any, any>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
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
    if (enabledTools && !enabledTools.has(tool.name)) {
      continue;
    }
    if (disabledTools && disabledTools.has(tool.name)) {
      continue;
    }
    server.registerTool(tool.name, tool.config as any, async (args) =>
      tracer.startActiveSpan(
        `mcp.tool.${tool.name}`,
        async (span): Promise<CallToolResult> => {
          span.setAttribute('mcp.tool.args', JSON.stringify(args));
          try {
            const result = await tool.fn(args as any);
            const text = JSON.stringify(result);
            span.setAttribute('mcp.tool.responseBytes', text.length);
            span.setStatus({ code: SpanStatusCode.OK });
            return {
              content: [
                {
                  type: 'text',
                  text,
                },
              ],
              structuredContent: result,
            };
          } catch (error) {
            log.error('Error invoking tool:', error as Error);
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

  additionalSetup?.({ context, server });

  return { server };
};
