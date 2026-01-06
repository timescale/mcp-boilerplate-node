import type { McpFeatureFlags, ResourceFactory } from '../types.js';
import type { ServerContextWithOctokit } from './types.js';
import {
  listSkills,
  loadSkills,
  parseSkillsFlags,
  skillsDescription,
  skillVisible,
  viewSkillContent,
} from './utils.js';

interface Options<Context extends ServerContextWithOctokit> {
  appendSkillsListToDescription?: boolean;
  description?: string;
  disabled?:
    | boolean
    | ((ctx: Context, flags: McpFeatureFlags) => boolean | Promise<boolean>);
  name?: string;
  title?: string;
  uriScheme?: string;
}

export const createSkillsResourceFactory =
  <Context extends ServerContextWithOctokit>(
    options: Options<Context> = {},
  ): ResourceFactory<ServerContextWithOctokit> =>
  async (ctx, mcpFlags) => {
    const { octokit } = ctx;
    const { query } = mcpFlags;
    const flags = parseSkillsFlags(query);
    return {
      type: 'templated',
      name: options.name || 'skills',
      disabled:
        typeof options.disabled === 'function'
          ? await options.disabled(ctx as Context, mcpFlags)
          : options.disabled,
      config: {
        title: options.title || 'Skills',
        description: `${options.description || skillsDescription}${
          options.appendSkillsListToDescription
            ? `\n\n## Available Skills\n\n${await listSkills(octokit, parseSkillsFlags(query))}`
            : ''
        }`,
      },
      uriTemplate: `${options.uriScheme || 'skills'}://{name}{?path}`,
      list: async (): Promise<{
        resources: Array<{
          uri: string;
          name: string;
          title: string;
          description: string;
          mimeType: string;
        }>;
      }> => {
        const skills = await loadSkills(octokit);
        return {
          resources: Array.from(skills.values())
            .filter((s) => skillVisible(s.name, flags))
            .map((skill) => ({
              uri: `${options.uriScheme || 'skills'}://${skill.name}?path=SKILL.md`,
              name: skill.name,
              title: skill.name,
              description: skill.description,
              mimeType: 'text/markdown',
            })),
        };
      },
      read: async (
        uri,
        { name, path },
      ): Promise<{ contents: { uri: string; text: string }[] }> => {
        if (Array.isArray(name) || Array.isArray(path) || !name) {
          throw new Error('Invalid parameters');
        }
        return {
          contents: [
            {
              uri: uri.href,
              text: await viewSkillContent(octokit, flags, name, path),
            },
          ],
        };
      },
    };
  };
