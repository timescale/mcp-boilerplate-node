// Test preload (configured via bunfig.toml) that silences console output so
// successful `bun test` / `bun check` runs stay quiet. Our logger and some
// dependencies write directly to the console, which would otherwise flood the
// output with logs. Set VERBOSE_TESTS=1 to keep the original console behavior
// when debugging.

if (!process.env.VERBOSE_TESTS) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
  console.error = noop;
}
