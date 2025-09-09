/**
 * REST API alternative to MCP for direct use of the same tools.
 */

import { Router } from 'express';
import bodyParser from 'body-parser';
import { z } from 'zod';
import { ApiFactory, RouterFactoryResult } from '../types.js';

export const apiRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiFactories: readonly ApiFactory<Context, any, any>[],
): RouterFactoryResult => {
  const router = Router();

  router.use(bodyParser.json());

  for (const factory of apiFactories) {
    const tool = factory(context);
    if (!tool.method || !tool.route) continue;

    router[tool.method](tool.route, async (req, res) => {
      const Input = z.object(tool.config.inputSchema);
      const input = {
        ...req.params,
        ...req.query,
        ...req.body,
      };

      let parsedInput: z.infer<typeof Input>;
      try {
        parsedInput = Input.parse(input);
      } catch (error) {
        res.status(400).json({ error: 'zod validation failure', issues: (error as z.ZodError).issues });
        return;
      }
      const result = await tool.fn(parsedInput);
      res.json(tool.pickResult ? tool.pickResult(result) : result);
    });
  }

  return [router, (): void => {}];
};
