// Test fixture: an MCP server over stdio with one `echo` tool.
// `src/stdio.spec.ts` starts this file as a child process.
import { z } from 'zod';
import { stdioServerFactory } from '../stdio.js';
import type { ApiFactory } from '../types.js';

const echoInput = { message: z.string() };
const echoOutput = { echoed: z.string() };

const echoFactory: ApiFactory<
  Record<string, unknown>,
  typeof echoInput,
  typeof echoOutput
> = () => ({
  name: 'echo',
  config: {
    title: 'Echo',
    description: 'Return the message',
    inputSchema: echoInput,
    outputSchema: echoOutput,
  },
  fn: async ({ message }) => ({ echoed: message }),
});

await stdioServerFactory({
  name: 'test-server',
  context: {},
  apiFactories: [echoFactory],
});
