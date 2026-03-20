import type { ApiFactory, McpFeatureFlags } from '../types.js';
import {
  type ServerContextWithOctokit,
  type ViewSkillOutputSchema,
  zViewSkillInputSchema,
  zViewSkillOutputSchema,
} from './types.js';
import {
  getAvailableSkillNames,
  InvalidPathError,
  listSkills,
  PathNotFoundError,
  parseSkillsFlags,
  SkillNotFoundError,
  SkillsApiError,
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
        try {
          return {
            content: await viewSkillContent({
              octokit,
              flags,
              name,
              path,
            }),
          };
        } catch (err) {
          if (!(err instanceof SkillsApiError)) {
            throw err;
          }
          const available = await getAvailableSkillNames({ octokit, flags });
          if (err instanceof SkillNotFoundError) {
            return {
              content: `Skill not found: ${err.skillName}. Available skills: ${available}. Use one of these names.`,
            };
          }
          if (err instanceof PathNotFoundError) {
            return {
              content: `Path not found: ${err.path}. Contents of skill "${err.skill}":\n${err.listing}\n\nUse path "SKILL.md" to read the main skill document.`,
            };
          }
          if (err instanceof InvalidPathError) {
            return {
              content: `${err.message}. Available skills: ${available}. Use name "." to list skills; use path "." to list a skill's contents.`,
            };
          }
          throw err;
        }
      },
    };
  };
