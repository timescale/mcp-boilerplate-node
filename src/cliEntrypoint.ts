export async function cliEntrypoint(
  stdioEntrypoint = './stdio.js',
  httpEntrypoint = './httpServer.js',
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
        // Import and run the HTTP server
        await import(httpEntrypoint);
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
