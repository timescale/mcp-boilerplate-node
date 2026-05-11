import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';
import type { DatabaseConfiguration } from './types.js';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function cliEntrypoint(
  stdioEntrypoint: string,
  httpEntrypoint: string,
  instrumentation = join(__dirname, './instrumentation.js'),
  dbConfig?: DatabaseConfiguration,
): Promise<void> {
  // Parse command line arguments first
  const args = process.argv.slice(2);
  const scriptName = args[0] || 'stdio';
  try {
    if (dbConfig) {
      log.info('starting server...');
      try {
        log.info('Running database migrations...');
        await runMigrations(dbConfig);
        log.info('Database migrations completed successfully');
      } catch (error) {
        log.error('Database migration failed:', error as Error);
        throw error;
      }
    }

    // Dynamically import only the requested module to prevent all modules from initializing
    switch (scriptName) {
      case 'stdio': {
        // Import and run the stdio server
        await import(stdioEntrypoint);
        break;
      }
      case 'http': {
        let cleanup: (() => Promise<void>) | undefined;
        if (
          args.includes('--instrument') ||
          process.env.INSTRUMENT?.toLowerCase().trim() === 'true'
        ) {
          const { instrument } = await import(instrumentation);
          ({ cleanup } = instrument());
        }
        // Import and run the HTTP server
        const { registerCleanupFn } = await import(httpEntrypoint);
        if (cleanup && registerCleanupFn) {
          registerCleanupFn(cleanup);
        }
        break;
      }
      default: {
        console.error(`Unknown script: ${scriptName}`);
        console.log('Available scripts:');
        console.log('- stdio');
        console.log('- http');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('Error running script:', error);
    process.exit(1);
  }
}
