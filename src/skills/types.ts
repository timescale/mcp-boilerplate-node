import type { Octokit } from '@octokit/rest';
import { z } from 'zod';
import type { InferSchema } from '../types.js';

export const zSkillType = z.enum([
  'local',
  'local_collection',
  'github',
  'github_collection',
]);

export type SkillType = z.infer<typeof zSkillType>;

export const zLocalSkillCfg = z.object({
  type: z.literal('local'),
  path: z.string(),
});
export type LocalSkillCfg = z.infer<typeof zLocalSkillCfg>;

const zCollectionFlagsCfg = z.object({
  enabled_skills: z.array(z.string()).optional(),
  disabled_skills: z.array(z.string()).optional(),
  ignored_paths: z.array(z.string()).optional(),
});
export type CollectionFlagsCfg = z.infer<typeof zCollectionFlagsCfg>;

export interface CollectionFlags {
  enabledSkills: Set<string> | null;
  disabledSkills: Set<string> | null;
  ignoredPaths: Set<string> | null;
}

export const zLocalCollectionSkillCfg = zCollectionFlagsCfg.extend({
  type: z.literal('local_collection'),
  path: z.string(),
});
export type LocalCollectionSkillCfg = z.infer<typeof zLocalCollectionSkillCfg>;

export const zGitHubSkillCfg = z.object({
  type: z.literal('github'),
  repo: z.string(),
  path: z.string().optional(),
});
export type GitHubSkillCfg = z.infer<typeof zGitHubSkillCfg>;

export const zGitHubCollectionSkillCfg = zCollectionFlagsCfg.extend({
  type: z.literal('github_collection'),
  repo: z.string(),
  path: z.string().optional(),
});
export type GitHubCollectionSkillCfg = z.infer<
  typeof zGitHubCollectionSkillCfg
>;

export const zSkillCfg = z.discriminatedUnion('type', [
  zLocalSkillCfg,
  zLocalCollectionSkillCfg,
  zGitHubSkillCfg,
  zGitHubCollectionSkillCfg,
]);
export type SkillCfg = z.infer<typeof zSkillCfg>;

export const zSkillCfgMap = z.record(zSkillCfg);
export type SkillCfgMap = z.infer<typeof zSkillCfgMap>;

export const zSkillMatter = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
});
export type SkillMatter = z.infer<typeof zSkillMatter>;

export const zLocalSkill = zSkillMatter.extend(zLocalSkillCfg.shape);
export type LocalSkill = z.infer<typeof zLocalSkill>;

export const zGitHubSkill = zSkillMatter.extend(zGitHubSkillCfg.shape);
export type GitHubSkill = z.infer<typeof zGitHubSkill>;

export const zSkill = z.discriminatedUnion('type', [zLocalSkill, zGitHubSkill]);
export type Skill = z.infer<typeof zSkill>;

export const zSkillMap = z.record(zSkill);
export type SkillMap = z.infer<typeof zSkillMap>;

export interface SkillsFlags {
  enabledSkills: Set<string> | null;
  disabledSkills: Set<string> | null;
}

export interface ServerContextWithOctokit extends Record<string, unknown> {
  octokit: Octokit;
}

export const zViewSkillInputSchema = {
  skill_name: z
    .string()
    .describe(
      'The name of the skill to browse, or `.` to list all available skills.',
    ),
  path: z.string().describe(
    `
A relative path to a file or directory within the skill to view.
If empty, will view the \`SKILL.md\` file by default.
Use \`.\` to list the root directory of the skill.
`.trim(),
  ),
} as const;
export type ViewSkillInputSchema = InferSchema<typeof zViewSkillInputSchema>;

export const zViewSkillOutputSchema = {
  content: z.string().describe('The content of the file or directory listing.'),
} as const;
export type ViewSkillOutputSchema = InferSchema<typeof zViewSkillOutputSchema>;
