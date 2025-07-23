/**
 * REST API alternative to MCP for direct use of the same tools.
 */

import { Router } from 'express';
import { z } from 'zod';
import { ApiFactory, RouterFactoryResult } from '../types.js';

export const apiRouterFactory = <Context extends Record<string, unknown>>(
  context: Context,
  apiFactories: readonly ApiFactory<Context, any, any>[],
): RouterFactoryResult => {
  const router = Router();

  for (const factory of apiFactories) {
    const tool = factory(context);
    if (!tool.method || !tool.route) continue;

    router[tool.method](tool.route, async (req, res) => {
      const Input = z.object(tool.config.inputSchema);
      const input = tool.method === 'get' ? req.query : req.body;
      const result = await tool.fn(Input.parse(input));
      res.json(tool.pickResult ? tool.pickResult(result) : result);
    });
  }

  return [router, () => {}];
};
