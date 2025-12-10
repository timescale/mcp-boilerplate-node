import { join } from 'path';

export async function cliEntrypoint(
  stdioEntrypoint: string,
  httpEntrypoint: string,
  instrumentation = join(import.meta.dir, './instrumentation.js'),
): Promise<void> {
  // Parse command line arguments first
  const args = process.argv.slice(2);
  const scriptName = args[0] || 'stdio';
  try {
    // Dynamically import only the requested module to prevent all modules from initializing
    switch (scriptName) {
      case 'stdio': {
        // Import and run the stdio server
        await import(stdioEntrypoint);
        break;
      }
      case 'http': {
        let cleanup;
        if (
          args.includes('--instrument') ||
          process.env.INSTRUMENT === 'true'
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
