import type { ApiFactory } from '../types.js';
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

interface Options {
  name?: string;
  method?: 'get' | 'post';
  route?: string;
  description?: string;
  title?: string;
}

export const createViewSkillToolFactory =
  (
    options: Options = {},
  ): ApiFactory<
    ServerContextWithOctokit,
    typeof zViewSkillInputSchema,
    typeof zViewSkillOutputSchema
  > =>
  ({ octokit }, { query }) => ({
    name: options.name || 'view',
    method: options.method || 'get',
    route: options.route || '/view',
    config: {
      title: options.title || 'View Skill',
      description: options.description || skillsDescription,
      inputSchema: zViewSkillInputSchema,
      outputSchema: zViewSkillOutputSchema,
    },
    fn: async ({
      skill_name,
      path: passedPath,
    }): Promise<ViewSkillOutputSchema> => {
      const flags = parseSkillsFlags(query);
      if (!skill_name || skill_name === '.') {
        return {
          content: await listSkills(octokit, flags),
        };
      }
      return {
        content: await viewSkillContent(octokit, flags, skill_name, passedPath),
      };
    },
  });
