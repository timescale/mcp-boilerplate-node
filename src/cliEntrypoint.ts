import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function cliEntrypoint(
  stdioEntrypoint: string,
  httpEntrypoint: string,
  instrumentation = join(__dirname, './instrumentation.js'),
) {
  // Parse command line arguments first
  const args = process.argv.slice(2);
  const scriptName = args[0] || 'stdio';
  try {
    // Dynamically import only the requested module to prevent all modules from initializing
    switch (scriptName) {
      case 'stdio':
        // Import and run the stdio server
        await import(stdioEntrypoint);
        break;
      case 'http':
        let cleanup;
        if (
          args.includes('--instrument') ||
          process.env.INSTRUMENT === 'true'
        ) {
          ({ cleanup } = await import(instrumentation));
        }
        // Import and run the HTTP server
        const { registerCleanupFn } = await import(httpEntrypoint);
        if (cleanup && registerCleanupFn) {
          registerCleanupFn(cleanup);
        }
        break;
      default:
        console.error(`Unknown script: ${scriptName}`);
        console.log('Available scripts:');
        console.log('- stdio');
        console.log('- http');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error running script:', error);
    process.exit(1);
  }
}
