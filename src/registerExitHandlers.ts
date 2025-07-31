import { log } from './logger.js';

let handlingExit = false;

export const registerExitHandlers = (
  cleanupFns: (() => void | Promise<void>)[],
) => {
  const exitHandler = (code = 0) => {
    if (handlingExit) return;
    handlingExit = true;

    log.info('Shutting down server...');

    Promise.allSettled(cleanupFns.map((fn) => fn())).finally(() => {
      log.info('Server shutdown complete');
      process.exit(code);
    });
  };

  // Handle server shutdown
  process.on('SIGINT', () => {
    exitHandler();
  });
  process.on('SIGTERM', () => {
    exitHandler();
  });
  process.on('uncaughtException', (err) => {
    log.error('Uncaught Exception:', err);
    exitHandler(1);
  });

  return exitHandler;
};
