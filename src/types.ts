import type {
  CompleteResourceTemplateCallback,
  ListResourcesCallback,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceMetadata,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  GetPromptResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { Router } from 'express';
import type { ZodRawShape, z } from 'zod';

// Compatibility helper: works with both Zod 3 and Zod 4
// Replaces z.objectOutputType which was removed in Zod 4
type ObjectOutput<T extends ZodRawShape> = z.infer<z.ZodObject<T>>;

// ===== Base types (type-erased for heterogeneous collections) =====

export type BaseToolConfig = {
  title?: string;
  description?: string;
  inputSchema: ZodRawShape;
  outputSchema: ZodRawShape;
  annotations?: ToolAnnotations;
};

export interface BaseApiDefinition {
  name: string;
  method?: 'get' | 'post' | 'put' | 'delete';
  route?: string | string[];
  config: BaseToolConfig;
  disabled?: boolean;
  // Method syntax is bivariant, allowing typed extensions to override with narrower types
  fn(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  pickResult?(result: Record<string, unknown>): unknown;
}

export type BaseApiFactory<Context extends Record<string, unknown>> = (
  ctx: Context,
  featureFlags: McpFeatureFlags,
) => BaseApiDefinition | Promise<BaseApiDefinition>;

export type BasePromptConfig = {
  title?: string;
  description?: string;
  inputSchema: ZodRawShape;
};

export interface BasePromptDefinition {
  name: string;
  config: BasePromptConfig;
  disabled?: boolean;
  // Method syntax is bivariant, allowing typed extensions to override with narrower types
  fn(args: Record<string, unknown>): Promise<GetPromptResult>;
}

export type BasePromptFactory<Context extends Record<string, unknown>> = (
  ctx: Context,
  featureFlags: McpFeatureFlags,
) => BasePromptDefinition | Promise<BasePromptDefinition>;

// ===== Typed versions (for implementations) =====

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
> extends BaseApiDefinition {
  config: ToolConfig<InputArgs, OutputArgs>;
  fn(args: ObjectOutput<InputArgs>): Promise<ObjectOutput<OutputArgs>>;
  pickResult?(result: ObjectOutput<OutputArgs>): SimplifiedOutputArgs;
}

export type ApiFactory<
  Context extends Record<string, unknown>,
  Input extends ZodRawShape,
  Output extends ZodRawShape,
  RestOutput = Output,
> = (
  ctx: Context,
  featureFlags: McpFeatureFlags,
) =>
  | ApiDefinition<Input, Output, RestOutput>
  | Promise<ApiDefinition<Input, Output, RestOutput>>;

export type RouterFactoryResult = [Router, () => void | Promise<void>];

export type PromptConfig<InputArgs extends ZodRawShape> = {
  title?: string;
  description?: string;
  inputSchema: InputArgs;
};

export interface PromptDefinition<InputArgs extends ZodRawShape>
  extends BasePromptDefinition {
  config: PromptConfig<InputArgs>;
  fn(args: ObjectOutput<InputArgs>): Promise<GetPromptResult>;
}

export type PromptFactory<
  Context extends Record<string, unknown>,
  Input extends ZodRawShape,
> = (ctx: Context, featureFlags: McpFeatureFlags) => PromptDefinition<Input>;

export interface TemplatedResourceDefinition {
  type: 'templated';
  name: string;
  uriTemplate: string;
  list?: ListResourcesCallback;
  complete?: {
    [variable: string]: CompleteResourceTemplateCallback;
  };
  config: ResourceMetadata;
  disabled?: boolean;
  read: ReadResourceTemplateCallback;
}

export interface StaticResourceDefinition {
  type: 'static';
  name: string;
  uri: string;
  config: ResourceMetadata;
  disabled?: boolean;
  read: ReadResourceCallback;
}

export type ResourceDefinition =
  | TemplatedResourceDefinition
  | StaticResourceDefinition;

export type ResourceFactory<Context extends Record<string, unknown>> = (
  ctx: Context,
  featureFlags: McpFeatureFlags,
) => ResourceDefinition | Promise<ResourceDefinition>;

export interface ParsedQs {
  [key: string]: undefined | string | ParsedQs | (string | ParsedQs)[];
}

export interface McpFeatureFlags {
  prompts?: boolean;
  enabledPrompts?: Set<string> | null;
  disabledPrompts?: Set<string> | null;
  resources?: boolean;
  enabledResources?: Set<string> | null;
  disabledResources?: Set<string> | null;
  tools?: boolean;
  enabledTools?: Set<string> | null;
  disabledTools?: Set<string> | null;
  query?: ParsedQs;
}

// Helper type to flatten intersection types
type Flatten<T> = { [K in keyof T]: T[K] } & {};

// Helper type to extract keys where the Zod type is optional
type OptionalKeys<T extends Record<string, z.ZodType>> = {
  [K in keyof T]: T[K] extends z.ZodOptional<z.ZodType> ? K : never;
}[keyof T];

// Helper type to extract keys where the Zod type is required
type RequiredKeys<T extends Record<string, z.ZodType>> = {
  [K in keyof T]: T[K] extends z.ZodOptional<z.ZodType> ? never : K;
}[keyof T];

export type InferSchema<T extends Record<string, z.ZodType>> = Flatten<
  {
    [K in RequiredKeys<T>]: z.infer<T[K]>;
  } & {
    [K in OptionalKeys<T>]?: z.infer<T[K]>;
  }
>;
