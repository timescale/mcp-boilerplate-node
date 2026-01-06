import {
  McpServer,
  ResourceTemplate,
  type ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  GetPromptResult,
  ListResourcesResult,
  ReadResourceResult,
  ServerCapabilities,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { log } from './logger.js';
import type {
  BaseApiFactory,
  BasePromptFactory,
  McpFeatureFlags,
  ResourceFactory,
} from './types.js';

const name = process.env.OTEL_SERVICE_NAME;
const tracer = trace.getTracer(name ? `${name}.mcpServer` : 'mcpServer');

const toSet = (str: string | undefined): Set<string> | null =>
  str ? new Set(str.split(',').map((s) => s.trim())) : null;

const enabledTools = toSet(process.env.MCP_ENABLED_TOOLS);
const disabledTools = toSet(process.env.MCP_DISABLED_TOOLS);
const enabledPrompts = toSet(process.env.MCP_ENABLED_PROMPTS);
const disabledPrompts = toSet(process.env.MCP_DISABLED_PROMPTS);
const enabledResources = toSet(process.env.MCP_ENABLED_RESOURCES);
const disabledResources = toSet(process.env.MCP_DISABLED_RESOURCES);

const shouldSkip = (
  item: { name: string; disabled?: boolean },
  enabledSets: (Set<string> | null | undefined)[],
  disabledSets: (Set<string> | null | undefined)[],
): boolean => {
  if (item.disabled) return true;
  for (const enabledSet of enabledSets) {
    if (enabledSet && !enabledSet.has(item.name)) {
      return true;
    }
  }
  for (const disabledSet of disabledSets) {
    if (disabledSet?.has(item.name)) {
      return true;
    }
  }
  return false;
};

export interface AdditionalSetupArgs<Context extends Record<string, unknown>> {
  context: Context;
  server: McpServer;
  featureFlags: McpFeatureFlags;
}

export const mcpServerFactory = async <
  Context extends Record<string, unknown>,
>({
  name,
  version = '1.0.0',
  context,
  apiFactories = [],
  promptFactories = [],
  resourceFactories = [],
  additionalSetup,
  additionalCapabilities = {},
  featureFlags = {},
  instructions,
}: {
  name: string;
  version?: string;
  context: Context;
  apiFactories?: readonly BaseApiFactory<Context>[];
  promptFactories?: readonly BasePromptFactory<Context>[];
  resourceFactories?: readonly ResourceFactory<Context>[];
  additionalSetup?: (args: AdditionalSetupArgs<Context>) => void;
  additionalCapabilities?: ServerCapabilities;
  featureFlags?: McpFeatureFlags;
  instructions?: string;
}): Promise<{ server: McpServer }> => {
  const enablePrompts = featureFlags.prompts !== false;
  const enableResources = featureFlags.resources !== false;
  const enableTools = featureFlags.tools !== false;
  const server = new McpServer(
    {
      name,
      version,
    },
    {
      capabilities: {
        ...(enableTools && apiFactories.length ? { tools: {} } : null),
        ...(enablePrompts && promptFactories.length ? { prompts: {} } : null),
        ...(enableResources && resourceFactories.length
          ? { resources: {} }
          : null),
        ...additionalCapabilities,
      },
      instructions,
    },
  );

  if (enableTools) {
    for (const factory of apiFactories) {
      const tool = await factory(context, featureFlags);
      if (
        shouldSkip(
          tool,
          [enabledTools, featureFlags.enabledTools],
          [disabledTools, featureFlags.disabledTools],
        )
      ) {
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
        (async (
          args: Record<string, unknown>,
          extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
        ): Promise<CallToolResult> => {
          let traceContext = otelContext.active();
          if (extra?._meta?.traceparent) {
            // Some MCP clients (e.g. pydantic) pass the parent trace context
            traceContext = propagation.extract(traceContext, {
              traceparent: extra._meta.traceparent,
              tracestate: extra._meta.tracestate,
            });
          }
          return tracer.startActiveSpan(
            `mcp.tool.${tool.name}`,
            { kind: SpanKind.SERVER },
            traceContext,
            async (span): Promise<CallToolResult> => {
              span.setAttribute('mcp.tool.args', JSON.stringify(args));
              try {
                const result = await tool.fn(args);
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
          );
        }) as ToolCallback<typeof tool.config.inputSchema>,
      );
    }
  }

  if (enablePrompts) {
    for (const factory of promptFactories) {
      const prompt = await factory(context, featureFlags);
      if (
        shouldSkip(
          prompt,
          [enabledPrompts, featureFlags.enabledPrompts],
          [disabledPrompts, featureFlags.disabledPrompts],
        )
      ) {
        continue;
      }
      server.registerPrompt(prompt.name, prompt.config, async (args) =>
        tracer.startActiveSpan(
          `mcp.prompt.${prompt.name}`,
          async (span): Promise<GetPromptResult> => {
            span.setAttribute('mcp.prompt.args', JSON.stringify(args));
            try {
              const result = await prompt.fn(args as Record<string, unknown>);
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
  }

  if (enableResources) {
    for (const factory of resourceFactories) {
      const resource = await factory(context, featureFlags);
      if (
        shouldSkip(
          resource,
          [enabledResources, featureFlags.enabledResources],
          [disabledResources, featureFlags.disabledResources],
        )
      ) {
        continue;
      }
      switch (resource.type) {
        case 'static': {
          server.registerResource(
            resource.name,
            resource.uri,
            resource.config,
            async (uri: URL, extra) =>
              tracer.startActiveSpan(
                `mcp.resource.static.${resource.name}`,
                async (span): Promise<ReadResourceResult> => {
                  span.setAttribute('mcp.resource.uri', uri.toString());
                  span.setAttribute(
                    'mcp.resource.extra',
                    JSON.stringify(extra),
                  );
                  try {
                    const result = await resource.read(uri, extra);
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                  } catch (error) {
                    log.error('Error invoking resource:', error as Error);
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
          break;
        }
        case 'templated': {
          server.registerResource(
            resource.name,
            new ResourceTemplate(resource.uriTemplate, {
              list:
                resource.list &&
                ((extra): Promise<ListResourcesResult> =>
                  tracer.startActiveSpan(
                    `mcp.resource.templated.${resource.name}.list`,
                    async (span): Promise<ListResourcesResult> => {
                      try {
                        if (!resource.list) {
                          throw new Error('resource.list is not defined');
                        }
                        const result = await resource.list(extra);
                        span.setAttribute(
                          'mcp.resource.list.uris',
                          result.resources.map((r) => r.uri).join(', '),
                        );
                        span.setStatus({ code: SpanStatusCode.OK });
                        return result;
                      } catch (error) {
                        log.error(
                          'Error invoking resource list:',
                          error as Error,
                        );
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
                  )),
              complete: resource.complete,
            }),
            resource.config,
            async (uri: URL, variables, extra) =>
              tracer.startActiveSpan(
                `mcp.resource.templated.${resource.name}`,
                async (span): Promise<ReadResourceResult> => {
                  span.setAttribute('mcp.resource.uri', uri.toString());
                  span.setAttribute(
                    'mcp.resource.variables',
                    JSON.stringify(variables),
                  );
                  span.setAttribute(
                    'mcp.resource.extra',
                    JSON.stringify(extra),
                  );
                  try {
                    const result = await resource.read(uri, variables, extra);
                    span.setStatus({ code: SpanStatusCode.OK });
                    return result;
                  } catch (error) {
                    log.error('Error invoking resource:', error as Error);
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
          break;
        }
        default: {
          // @ts-expect-error exhaustive check
          throw new Error(`Unknown resource type: ${resource.type}`);
        }
      }
    }
  }

  additionalSetup?.({ context, server, featureFlags });

  return { server };
};
