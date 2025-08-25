import { z } from 'zod';
import type { ZodRawShape, ZodTypeAny } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Router } from 'express';

export type ToolConfig<
  InputArgs extends ZodRawShape,
  OutputArgs extends ZodRawShape,
> = {
  title?: string;
  description?: string;
  inputSchema: InputArgs;
  outputSchema: OutputArgs;
  annotations?: ToolAnnotations;
};

export interface ApiDefinition<
  InputArgs extends ZodRawShape,
  OutputArgs extends ZodRawShape,
  SimplifiedOutputArgs = OutputArgs,
> {
  name: string;
  method?: 'get' | 'post' | 'put' | 'delete';
  route?: string | string[];
  config: ToolConfig<InputArgs, OutputArgs>;
  fn: (
    args: z.objectOutputType<InputArgs, ZodTypeAny>,
  ) => Promise<z.objectOutputType<OutputArgs, ZodTypeAny>>;
  // workaround for the fact that OutputArgs can't be an array
  pickResult?: (
    result: z.objectOutputType<OutputArgs, ZodTypeAny>,
  ) => SimplifiedOutputArgs;
}

export type ApiFactory<
  Context extends Record<string, unknown>,
  Input extends ZodRawShape,
  Output extends ZodRawShape,
  RestOutput = Output,
> = (ctx: Context) => ApiDefinition<Input, Output, RestOutput>;

export type RouterFactoryResult = [Router, () => void | Promise<void>];
