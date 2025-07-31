import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter as GrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as HttpTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  BatchSpanProcessor,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  BatchLogRecordProcessor,
  LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { log } from './logger.js';

const spanProcessors: SpanProcessor[] = [];
const logRecordProcessors: LogRecordProcessor[] = [];

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  spanProcessors.push(new BatchSpanProcessor(new GrpcTraceExporter()));
}
if (process.env.JAEGER_TRACES_ENDPOINT) {
  spanProcessors.push(
    new BatchSpanProcessor(
      new GrpcTraceExporter({
        url: process.env.JAEGER_TRACES_ENDPOINT,
      }),
    ),
  );
}
if (process.env.LOGFIRE_TRACES_ENDPOINT) {
  spanProcessors.push(
    new BatchSpanProcessor(
      new HttpTraceExporter({
        url: process.env.LOGFIRE_TRACES_ENDPOINT,
        headers: process.env.LOGFIRE_TOKEN
          ? { Authorization: `Bearer ${process.env.LOGFIRE_TOKEN}` }
          : {},
      }),
    ),
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
});

// Initialize the SDK and register with the OpenTelemetry API
sdk.start();

log.info('OpenTelemetry initialized');

export const cleanup = async () => {
  try {
    await Promise.all(spanProcessors.map((sp) => sp.shutdown()));
    await Promise.all(logRecordProcessors.map((lp) => lp.shutdown()));
    await sdk.shutdown();
    log.info('OpenTelemetry terminated');
  } catch (error) {
    log.error('Error terminating OpenTelemetry', error as Error);
  }
};
