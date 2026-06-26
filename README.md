# MCP Boilerplate for Node.js

This provides some common code for creating a [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) server in Node.js.

## Usage

```bash
npm install @tigerdata/mcp-boilerplate
```

See [tiger-skills-mcp-server](https://github.com/tigerdata/tiger-skills-mcp-server) for an example MCP server using this boilerplate.

### DNS Rebinding Protection

MCP servers reachable over HTTP can be targeted by [DNS rebinding attacks](https://en.wikipedia.org/wiki/DNS_rebinding), where a malicious website bypasses the browser same-origin policy by pointing a domain at a localhost (or otherwise private) address to reach a local server. The MCP SDK guards against this by validating the `Host` header against an allow-list.

This check is **most useful for localhost / development servers** without HTTPS or authentication. Hosted servers served on public hostnames generally don't need it (and would reject legitimate traffic unless every allowed hostname is listed), so `httpServerFactory` leaves it **disabled by default** — it is opt-in via the `dnsRebindingProtection` option (scoped to the MCP and API mount paths):

```ts
import { httpServerFactory } from '@tigerdata/mcp-boilerplate';

await httpServerFactory({
  name: 'my-server',
  context,
  // Omitted (default): disabled, UNLESS MCP_ALLOWED_HOSTS is set — in which
  //   case protection is enabled using that env var's allow-list.
  // true: enabled. Uses the MCP_ALLOWED_HOSTS allow-list when set, otherwise
  //   localhost-only (localhost, 127.0.0.1, [::1]).
  // string[]: enabled with this exact allow-list (MCP_ALLOWED_HOSTS ignored).
  //   Hostnames only, without ports; use [::1] for IPv6.
  // false: disabled. Always wins, even if MCP_ALLOWED_HOSTS is set.
  dnsRebindingProtection: true,
});
```

The `MCP_ALLOWED_HOSTS` environment variable can both enable and configure protection without touching code: set it to a comma-separated list of hostnames (e.g. `localhost,127.0.0.1,[::1]`) and protection turns on using that list. It is consulted whenever `dnsRebindingProtection` is omitted or `true`, but is ignored when an explicit `string[]` is passed (that list wins) or when `false` is passed (protection stays off).

### Binding to a specific network interface

Separately from Host header validation, you can restrict which network interface the server's socket accepts connections on via the `host` option (forwarded to `app.listen()`). Binding to loopback is an OS-level defense that makes the port unreachable from other machines entirely — useful for localhost/development servers:

```ts
await httpServerFactory({
  name: 'my-server',
  context,
  host: '127.0.0.1', // only accept connections on loopback
});
```

Defaults to the `HOST` environment variable, or all available interfaces when unset. This is independent of `dnsRebindingProtection` and is ignored when an external `app` is provided (the caller owns the server lifecycle).

### Skills

Add skills support to your MCP server by leveraging the skills submodule in `@tigerdata/mcp-boilerplate/skills`. See the [Skills README](./src/skills/README.md) for details.

## Eslint Plugin

This project includes a custom ESLint plugin to guard against the problematic use of optional parameters for tool inputs. Doing so leads to tools that are incompatible with certain models, such as GPT-5.

Add to your `eslint.config.mjs`:

```js
import boilerplatePlugin from '@tigerdata/mcp-boilerplate/eslintPlugin';
export default [
  // ... your existing config
  {
    plugins: {
      'mcp-boilerplate': boilerplatePlugin,
    },
    rules: {
      'mcp-boilerplate/no-optional-tool-params': 'error',
    },
  },
];
```

## Development

### Build

To build the TypeScript project:

```bash
./bun run build
```

This compiles the TypeScript files from `src/` to JavaScript in `dist/`.

### Watch Mode

To run TypeScript compilation in watch mode (rebuilds on file changes):

```bash
./bun run watch
```

### Linting

This project uses ESLint for code linting with TypeScript support.

To run the linter:

```bash
./bun run lint
```

To automatically fix linting issues where possible:

```bash
./bun run lint --write
```

### Continuous Integration

The project includes GitHub Actions that automatically run linting checks on all pushes and pull requests to ensure code quality standards are maintained.
