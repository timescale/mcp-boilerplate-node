import { describe, expect, it } from 'bun:test';
import Path from 'node:path';
import { createSkillsPromptFactories } from './prompts.js';
import type { ServerContextWithOctokit } from './types.js';

process.env.SKILLS_FILE = Path.resolve(
  import.meta.dir,
  '__fixtures__',
  'skills.yaml',
);

const context = { octokit: undefined } as unknown as ServerContextWithOctokit;

const promptsFor = async (query: Record<string, string>) => {
  const factories = await createSkillsPromptFactories();
  return Promise.all(factories.map((factory) => factory(context, { query })));
};

describe('createSkillsPromptFactories', () => {
  it('creates an enabled prompt per skill when no skill flags are set', async () => {
    const prompts = await promptsFor({});
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'collection-a',
      'collection-b',
      'first-skill',
      'second-skill',
    ]);
    expect(prompts.every((p) => !p.disabled)).toBe(true);
  });

  it('marks skills in disabled_skills as disabled so they are not listed', async () => {
    const prompts = await promptsFor({ disabled_skills: 'first-skill' });
    const disabled = prompts.filter((p) => p.disabled).map((p) => p.name);
    expect(disabled).toEqual(['first-skill']);
  });

  it('supports comma-separated disabled_skills', async () => {
    const prompts = await promptsFor({
      disabled_skills: 'first-skill,second-skill',
    });
    const disabled = prompts
      .filter((p) => p.disabled)
      .map((p) => p.name)
      .sort();
    expect(disabled).toEqual(['first-skill', 'second-skill']);
  });

  it('marks skills outside enabled_skills as disabled', async () => {
    const prompts = await promptsFor({ enabled_skills: 'first-skill' });
    const enabled = prompts.filter((p) => !p.disabled).map((p) => p.name);
    expect(enabled).toEqual(['first-skill']);
  });
});
