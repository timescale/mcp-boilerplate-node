# MCP Boilerplate for Node.js

This provides some common code for creating a [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) server in Node.js.

## Usage

```bash
npm install @tigerdata/mcp-boilerplate
```

See [tiger-skills-mcp-server](https://github.com/tigerdata/tiger-skills-mcp-server) for an example MCP server using this boilerplate.

### Skills

Add skills support to your MCP server by leveraging the skills submodule in `@tigerdata/mcp-boilerplate/skills`. See [src/skills/README.md](./skills/README.md) for details.

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
