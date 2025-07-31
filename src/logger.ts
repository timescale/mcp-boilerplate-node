import { LogAttributes, logs, SeverityNumber } from '@opentelemetry/api-logs';

const name = process.env.OTEL_SERVICE_NAME || 'mcp-app';
const logger = logs.getLogger(name);

interface LogInterface {
  debug: (body: string, attributes?: LogAttributes) => void;
  info: (body: string, attributes?: LogAttributes) => void;
  warn: (body: string, attributes?: LogAttributes) => void;
  error: (
    body: string,
    error?: Error | null,
    attributes?: LogAttributes,
  ) => void;
}

// Helper functions to replace console.log
export const log: LogInterface = {
  debug: (...args) => {
    console.debug(...args);
    const [body, attributes] = args;
    logger.emit({
      severityText: 'DEBUG',
      severityNumber: SeverityNumber.DEBUG,
      body,
      attributes: {
        'log.level': 'debug',
        'service.name': name,
        ...attributes,
      },
    });
  },

  info: (...args) => {
    console.info(...args);
    const [body, attributes] = args;
    logger.emit({
      severityText: 'INFO',
      severityNumber: SeverityNumber.INFO,
      body,
      attributes: {
        'log.level': 'info',
        'service.name': name,
        ...attributes,
      },
    });
  },

  warn: (...args) => {
    console.warn(...args);
    const [body, attributes] = args;
    logger.emit({
      severityText: 'WARN',
      severityNumber: SeverityNumber.WARN,
      body,
      attributes: {
        'log.level': 'warn',
        'service.name': name,
        ...attributes,
      },
    });
  },

  error: (...args) => {
    console.error(...args);
    const [body, error, attributes] = args;
    logger.emit({
      severityText: 'ERROR',
      severityNumber: SeverityNumber.ERROR,
      body,
      attributes: {
        'log.level': 'error',
        'service.name': name,
        ...(error && {
          'error.name': error.name,
          'error.message': error.message,
          'error.stack': error.stack,
        }),
        ...attributes,
      },
    });
  },
};
