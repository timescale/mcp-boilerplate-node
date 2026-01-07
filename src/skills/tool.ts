import type { ApiFactory, McpFeatureFlags } from '../types.js';
import {
  type ServerContextWithOctokit,
  type ViewSkillOutputSchema,
  zViewSkillInputSchema,
  zViewSkillOutputSchema,
} from './types.js';
import {
  listSkills,
  parseSkillsFlags,
  skillsDescription,
  viewSkillContent,
} from './utils.js';

interface Options<Context extends ServerContextWithOctokit> {
  appendSkillsListToDescription?: boolean;
  description?: string;
  disabled?:
    | boolean
    | ((ctx: Context, flags: McpFeatureFlags) => boolean | Promise<boolean>);
  method?: 'get' | 'post';
  name?: string;
  route?: string;
  title?: string;
}

export const createViewSkillToolFactory =
  <Context extends ServerContextWithOctokit>(
    options: Options<Context> = {},
  ): ApiFactory<
    ServerContextWithOctokit,
    typeof zViewSkillInputSchema,
    typeof zViewSkillOutputSchema
  > =>
  async (ctx, mcpFlags) => {
    const { octokit } = ctx;
    const flags = parseSkillsFlags(mcpFlags.query);
    return {
      name: options.name || 'view',
      disabled:
        typeof options.disabled === 'function'
          ? await options.disabled(ctx as Context, mcpFlags)
          : options.disabled,
      method: options.method || 'get',
      route: options.route || '/view',
      config: {
        title: options.title || 'View Skill',
        description: `${options.description || skillsDescription}${
          options.appendSkillsListToDescription
            ? `\n\n## Available Skills\n\n${await listSkills({ octokit, flags })}`
            : ''
        }`,
        inputSchema: zViewSkillInputSchema,
        outputSchema: zViewSkillOutputSchema,
      },
      fn: async ({
        skill_name: name,
        path,
      }): Promise<ViewSkillOutputSchema> => {
        if (!name || name === '.') {
          return {
            content: await listSkills({ octokit, flags }),
          };
        }
        return {
          content: await viewSkillContent({
            octokit,
            flags,
            name,
            path,
          }),
        };
      },
    };
  };
