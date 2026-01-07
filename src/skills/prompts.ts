import type { Octokit } from '@octokit/rest';
import type { PromptFactory } from '../types.js';
import type { ServerContextWithOctokit } from './types.js';
import { loadSkills, parseSkillsFlags, viewSkillContent } from './utils.js';

interface Options {
  octokit?: Octokit;
}

interface PromptResult {
  [x: string]: unknown;
  description: string;
  messages: {
    role: 'user';
    content: {
      type: 'text';
      text: string;
    };
  }[];
}

// Create a prompt for each skill from the main SKILL.md files.
export const createSkillsPromptFactories = async (
  options: Options = {},
): Promise<
  PromptFactory<ServerContextWithOctokit, Record<string, never>>[]
> => {
  const skills = await loadSkills(options);
  return Array.from(skills.entries()).map<
    PromptFactory<ServerContextWithOctokit, Record<string, never>>
  >(([name, skillData]) => ({ octokit }, { query }) => ({
    name,
    config: {
      // Using the dash-separated name as the title to work around a problem in Claude Code
      // See https://github.com/anthropics/claude-code/issues/7464
      title: name,
      description: skillData.description,
      inputSchema: {}, // No arguments for static skills
    },
    fn: async (): Promise<PromptResult> => {
      const flags = parseSkillsFlags(query);
      const content = await viewSkillContent({ octokit, flags, name });
      return {
        description: skillData.description || name,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: content,
            },
          },
        ],
      };
    },
  }));
};
