import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';

// Register one global tracer provider for all tests. A module-level tracer
// keeps the first provider that it finds, thus the tests must not replace or
// disable the provider. Call `spanExporter.reset()` between tests.
export const spanExporter = new InMemorySpanExporter();

trace.setGlobalTracerProvider(
  new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
  }),
);
