import { z } from 'zod';
import type { ZodRawShape, ZodTypeAny } from 'zod';
import type { ToolAnnotations, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
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
  disabled?: boolean;
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

export type PromptConfig<InputArgs extends ZodRawShape> = {
  title?: string;
  description?: string;
  inputSchema: InputArgs;
};

export interface PromptDefinition<InputArgs extends ZodRawShape> {
  name: string;
  config: PromptConfig<InputArgs>;
  fn: (
    args: z.objectOutputType<InputArgs, ZodTypeAny>,
  ) => Promise<GetPromptResult>;
}

export type PromptFactory<
  Context extends Record<string, unknown>,
  Input extends ZodRawShape,
> = (ctx: Context) => PromptDefinition<Input>;
