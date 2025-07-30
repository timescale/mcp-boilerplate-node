let handlingExit = false;

export const registerExitHandlers = (
  cleanupFns: (() => void | Promise<void>)[],
) => {
  const exitHandler = (code = 0) => {
    if (handlingExit) return;
    handlingExit = true;

    console.error('Shutting down server...');

    Promise.allSettled(cleanupFns.map((fn) => fn())).finally(() => {
      console.error('Server shutdown complete');
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
    console.error('Uncaught Exception:', err);
    exitHandler(1);
  });

  return exitHandler;
};
