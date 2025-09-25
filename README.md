# MCP Boilerplate for Node.js

TesT Foo

This provides some common code for creating a [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) server in Node.js.

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd mcp-boilerplate-node
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Development

### Build

To build the TypeScript project:

```bash
npm run build
```

This compiles the TypeScript files from `src/` to JavaScript in `dist/`.

### Watch Mode

To run TypeScript compilation in watch mode (rebuilds on file changes):

```bash
npm run watch
```

### Linting

This project uses ESLint for code linting with TypeScript support.

To run the linter:

```bash
npm run lint
```

To automatically fix linting issues where possible:

```bash
npm run lint:fix
```

### Continuous Integration

The project includes GitHub Actions that automatically run linting checks on all pushes and pull requests to ensure code quality standards are maintained.
