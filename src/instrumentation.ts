import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter as GrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as HttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  BatchSpanProcessor,
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  BatchLogRecordProcessor,
  LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Context } from '@opentelemetry/api';
import { log } from './logger.js';

/**
 * Custom span processor that filters out specific HTTP errors before sending to exporters.
 * This prevents noise from expected errors (like 405 Method Not Allowed for GET requests).
 */
class FilteringSpanProcessor implements SpanProcessor {
  private readonly wrapped: SpanProcessor;

  constructor(wrapped: SpanProcessor) {
    this.wrapped = wrapped;
  }

  onStart(span: Parameters<SpanProcessor['onStart']>[0], parentContext: Context): void {
    this.wrapped.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // Filter out 405 errors for GET requests on /mcp endpoint
    const httpMethod = span.attributes['http.method'] || span.attributes['http.request.method'];
    const httpStatusCode = span.attributes['http.status_code'] || span.attributes['http.response.status_code'];
    const httpTarget = span.attributes['http.target'] || span.attributes['url.path'];

    if (
      httpMethod === 'GET' &&
      httpStatusCode === 405 &&
      (httpTarget === '/mcp' || httpTarget === '/mcp/')
    ) {
      // Don't send this span to the exporter
      return;
    }

    this.wrapped.onEnd(span);
  }

  async forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }

  async shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }
}

const spanProcessors: SpanProcessor[] = [];
const logRecordProcessors: LogRecordProcessor[] = [];

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  spanProcessors.push(
    new FilteringSpanProcessor(
      new BatchSpanProcessor(new GrpcTraceExporter())
    )
  );
}
if (process.env.JAEGER_TRACES_ENDPOINT) {
  spanProcessors.push(
    new FilteringSpanProcessor(
      new BatchSpanProcessor(
        new GrpcTraceExporter({
          url: process.env.JAEGER_TRACES_ENDPOINT,
        }),
      ),
    )
  );
}
if (process.env.LOGFIRE_TRACES_ENDPOINT) {
  spanProcessors.push(
    new FilteringSpanProcessor(
      new BatchSpanProcessor(
        new HttpTraceExporter({
          url: process.env.LOGFIRE_TRACES_ENDPOINT,
          headers: process.env.LOGFIRE_TOKEN
            ? { Authorization: `Bearer ${process.env.LOGFIRE_TOKEN}` }
            : {},
        }),
      ),
    )
  );
}
if (process.env.LOGFIRE_LOGS_ENDPOINT) {
  logRecordProcessors.push(
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: process.env.LOGFIRE_LOGS_ENDPOINT,
        headers: process.env.LOGFIRE_TOKEN
          ? { Authorization: `Bearer ${process.env.LOGFIRE_TOKEN}` }
          : {},
      }),
    ),
  );
}

export const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
  spanProcessors,
  logRecordProcessors,
  resource: resourceFromAttributes({
    'deployment.environment.name':
      process.env.LOGFIRE_ENVIRONMENT || process.env.NODE_ENV || 'development',
    'service.instance.id': process.env.HOSTNAME,
  }),
});

// Initialize the SDK and register with the OpenTelemetry API
sdk.start();

log.info('OpenTelemetry initialized');

export const cleanup = async (): Promise<void> => {
  try {
    await Promise.all(spanProcessors.map((sp) => sp.shutdown()));
    await Promise.all(logRecordProcessors.map((lp) => lp.shutdown()));
    await sdk.shutdown();
    log.info('OpenTelemetry terminated');
  } catch (error) {
    log.error('Error terminating OpenTelemetry', error as Error);
  }
};
