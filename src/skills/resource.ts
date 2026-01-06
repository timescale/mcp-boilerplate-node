import type { ResourceFactory } from '../types.js';
import type { ServerContextWithOctokit } from './types.js';
import {
  loadSkills,
  parseSkillsFlags,
  skillsDescription,
  skillVisible,
  viewSkillContent,
} from './utils.js';

export const skillsResourceFactory: ResourceFactory<
  ServerContextWithOctokit
> = ({ octokit }, { query }) => {
  const flags = parseSkillsFlags(query);
  return {
    type: 'templated',
    name: 'skills',
    config: {
      title: 'Skills',
      description: skillsDescription,
    },
    uriTemplate: 'skills://{name}{?path}',
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
            uri: `skills://${skill.name}?path=SKILL.md`,
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
