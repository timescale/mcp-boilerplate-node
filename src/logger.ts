import {
  type LogAttributes,
  logs,
  SeverityNumber,
} from '@opentelemetry/api-logs';

const name = process.env.OTEL_SERVICE_NAME || 'mcp-app';
const logger = logs.getLogger(name);

// The CONSOLE_LOG_LEVEL environment variable controls the minimum severity that
// is written to the console: 'debug', 'info', 'warn', 'error', or 'none' to
// disable console output entirely. Defaults to 'debug' (everything). The
// OpenTelemetry log records are always emitted regardless of this setting.
type ConsoleLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const consoleLogLevelSeverity: Record<ConsoleLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

const configuredConsoleLogLevel = (
  process.env.CONSOLE_LOG_LEVEL || 'debug'
).toLowerCase() as ConsoleLogLevel;

if (!(configuredConsoleLogLevel in consoleLogLevelSeverity)) {
  throw new Error(
    `Invalid CONSOLE_LOG_LEVEL '${process.env.CONSOLE_LOG_LEVEL}'. ` +
      `Expected one of: ${Object.keys(consoleLogLevelSeverity).join(', ')}.`,
  );
}

const minConsoleLogSeverity =
  consoleLogLevelSeverity[configuredConsoleLogLevel];

const writeToConsole = (
  level: Exclude<ConsoleLogLevel, 'none'>,
  ...args: Parameters<typeof console.error>
): void => {
  if (consoleLogLevelSeverity[level] >= minConsoleLogSeverity) {
    console.error(...args);
  }
};

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
// We use console.error for all levels so that messages are written to stderr
// and not stdout, which would interfere with the stdio MCP transport.
export const log: LogInterface = {
  debug: (...args) => {
    writeToConsole('debug', ...args);
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
    writeToConsole('info', ...args);
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
    writeToConsole('warn', ...args);
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
    writeToConsole('error', ...args);
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
