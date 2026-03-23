import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import Path from 'node:path';
import { log } from '../logger.js';
import { createViewSkillToolFactory } from './tool.js';
import type { ViewSkillOutputSchema } from './types.js';

process.env.SKILLS_FILE = Path.resolve(
  import.meta.dir,
  '__fixtures__',
  'skills.yaml',
);

describe('createViewSkillToolFactory', () => {
  let warnSpy: ReturnType<typeof spyOn<typeof log, 'warn'>>;
  let fn: (args: {
    skill_name: string;
    path: string;
  }) => Promise<ViewSkillOutputSchema>;

  beforeAll(async () => {
    const factory = createViewSkillToolFactory();
    const tool = await factory({ octokit: null }, { query: {} });
    fn = tool.fn;
    warnSpy = spyOn(log, 'warn');
  });

  beforeEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('lists skills when skill_name is "."', async () => {
    const result = await fn({ skill_name: '.', path: '' });
    expect(result.content).toContain('<available_skills>');
    expect(result.content).toContain('first-skill');
    expect(result.content).toContain('second-skill');
  });

  it('lists skills when skill_name is empty', async () => {
    const result = await fn({ skill_name: '', path: '' });
    expect(result.content).toContain('<available_skills>');
    expect(result.content).toContain('first-skill');
    expect(result.content).toContain('second-skill');
  });

  it('returns skill content for valid name and path', async () => {
    const result = await fn({ skill_name: 'first-skill', path: 'SKILL.md' });
    expect(result.content).toBe('First skill content\n');
  });

  it('returns recovery string with available skills for nonexistent skill', async () => {
    const result = await fn({ skill_name: 'nonexistent', path: 'SKILL.md' });
    expect(result.content).toContain('Skill not found: nonexistent');
    expect(result.content).toContain('first-skill');
    expect(result.content).toContain('second-skill');
    expect(warnSpy).toHaveBeenCalledWith(
      'Skill not found: nonexistent',
      expect.objectContaining({
        error: 'SkillNotFoundError',
        skill: 'nonexistent',
      }),
    );
  });

  it('returns recovery string with directory listing for nonexistent path', async () => {
    const result = await fn({
      skill_name: 'first-skill',
      path: 'does-not-exist',
    });
    expect(result.content).toContain('Path not found: does-not-exist');
    expect(result.content).toContain('first-skill');
    expect(result.content).toContain('SKILL.md');
    expect(warnSpy).toHaveBeenCalledWith(
      'Path not found: does-not-exist in skill first-skill',
      expect.objectContaining({
        error: 'PathNotFoundError',
        skill: 'first-skill',
        path: 'does-not-exist',
      }),
    );
  });

  it('returns recovery string for directory traversal path', async () => {
    const result = await fn({
      skill_name: 'first-skill',
      path: '../../etc/passwd',
    });
    expect(result.content).toContain('Invalid path: ../../etc/passwd.');
    expect(result.content).toContain('first-skill');
    expect(result.content).toContain('second-skill');
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid path: ../../etc/passwd',
      expect.objectContaining({
        error: 'InvalidPathError',
        path: '../../etc/passwd',
      }),
    );
  });

  it('returns recovery string for null byte path', async () => {
    const result = await fn({
      skill_name: 'first-skill',
      path: 'SKILL.md\x00.txt',
    });
    expect(result.content).toContain('Invalid path: SKILL.md\x00.txt.');
    expect(result.content).toContain('first-skill');
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid path: SKILL.md\x00.txt',
      expect.objectContaining({
        error: 'InvalidPathError',
        path: 'SKILL.md\x00.txt',
      }),
    );
  });
});
