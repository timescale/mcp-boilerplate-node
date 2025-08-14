import type { Span, Tracer } from '@opentelemetry/api';
import type { GenerateTextResult, ModelMessage, ToolResultPart } from 'ai';
import { log } from './logger.js';

export const withSpan = async <T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> => {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      log.error(`Error in span ${name}`, error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
};

const getToolContent = (content: ToolResultPart) => {
  const { type, value } = content.output;
  if (type === 'json' && value) {
    if (typeof value === 'object' && 'structuredContent' in value) {
      return value.structuredContent;
    } else if (typeof value === 'object' && 'content' in value) {
      return value.content;
    }
    return value;
  } else if (value) {
    return value;
  }
  return content.output;
};

const annotateModelMessage = (m: ModelMessage, i: number) => {
  const msg: Record<string, any> = {
    ...m,
    'event.name': `gen_ai.${m.role}.message`,
    'gen_ai.message.index': Math.max(0, i - 1),
  };
  if (m.role === 'tool' && Array.isArray(m.content)) {
    const [c] = m.content;
    msg.id = c.toolCallId;
    msg.name = c.toolName;
    msg.content = getToolContent(c);
  }
  return msg;
};

export const addAiResultToSpan = (
  span: Span,
  aiResult: GenerateTextResult<any, unknown>,
  inputMessages: ModelMessage[],
) => {
  span.setAttribute('final_result', aiResult.text);
  const messages = [...inputMessages, ...aiResult.response.messages].map(
    annotateModelMessage,
  );
  span.setAttribute('all_messages_events', JSON.stringify(messages));
  // This is required for logfire to parse the events properly
  span.setAttribute(
    'logfire.json_schema',
    JSON.stringify({
      type: 'object',
      properties: { all_messages_events: { type: 'array' } },
    }),
  );
  if (aiResult.totalUsage) {
    span.setAttribute(
      'gen_ai.usage.input_tokens',
      aiResult.totalUsage.inputTokens || 0,
    );
    span.setAttribute(
      'gen_ai.usage.output_tokens',
      aiResult.totalUsage.outputTokens || 0,
    );
  }
};
