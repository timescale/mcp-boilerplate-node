import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiFactory, PromptFactory, ToolConfig } from './types.js';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { CallToolResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
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
  promptFactories = [],
  additionalSetup,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories: readonly ApiFactory<Context, any, any>[];
  promptFactories?: readonly PromptFactory<Context, any>[];
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
        ...(promptFactories.length ? { prompts: {} } : null),
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
    server.registerTool(
      tool.name,
      {
        ...tool.config,
        annotations: {
          ...tool.config.annotations,
          // Some clients (e.g. claude code) do not yet support the title field
          // at the top level and instead expect it in annotations. We also
          // don't allow setting different titles in two places as that doesn't
          // make sense.
          title: tool.config.title,
        },
      },
      async (args: { [x: string]: any }) =>
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

  for (const factory of promptFactories) {
    const prompt = factory(context);
    server.registerPrompt(prompt.name, prompt.config as any, async (args) =>
      tracer.startActiveSpan(
        `mcp.prompt.${prompt.name}`,
        async (span): Promise<GetPromptResult> => {
          span.setAttribute('mcp.prompt.args', JSON.stringify(args));
          try {
            const result = await prompt.fn(args as any);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            log.error('Error invoking prompt:', error as Error);
            span.recordException(error as Error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: (error as Error).message,
            });
            throw error;
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
