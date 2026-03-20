import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Path from 'node:path';
import {
  getAvailableSkillNames,
  listSkills,
  SkillsApiError,
  viewSkillContent,
} from './utils.js';

describe('Skills API', () => {
  let tempRoot = '';
  let previousSkillsFile: string | undefined;

  beforeAll(async () => {
    previousSkillsFile = process.env.SKILLS_FILE;
    tempRoot = await mkdtemp(Path.join(tmpdir(), 'skills-test-'));

    const firstSkillDir = Path.join(tempRoot, 'first-skill');
    const secondSkillDir = Path.join(tempRoot, 'second-skill');
    await mkdir(firstSkillDir, { recursive: true });
    await mkdir(secondSkillDir, { recursive: true });

    await writeFile(
      Path.join(firstSkillDir, 'SKILL.md'),
      `---
name: first-skill
description: First test skill
---
First skill content
`,
      'utf-8',
    );
    await writeFile(
      Path.join(secondSkillDir, 'SKILL.md'),
      `---
name: second-skill
description: Second test skill
---
Second skill content
`,
      'utf-8',
    );

    await writeFile(
      Path.join(tempRoot, 'skills.yaml'),
      `first-skill:
  type: local
  path: ${firstSkillDir}
second-skill:
  type: local
  path: ${secondSkillDir}
`,
      'utf-8',
    );

    process.env.SKILLS_FILE = Path.join(tempRoot, 'skills.yaml');
  });

  afterAll(async () => {
    if (previousSkillsFile === undefined) {
      delete process.env.SKILLS_FILE;
    } else {
      process.env.SKILLS_FILE = previousSkillsFile;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  describe('getAvailableSkillNames', () => {
    it('returns a comma-separated list of visible skill names in alphabetical order when skills are loaded', async () => {
      const names = await getAvailableSkillNames({});
      expect(names).toBe('first-skill, second-skill');
    });

    it('returns "(none)" when flags filter out every skill (e.g. enabledSkills does not match any)', async () => {
      const names = await getAvailableSkillNames({
        flags: {
          enabledSkills: new Set(['does-not-exist']),
          disabledSkills: null,
        },
      });
      expect(names).toBe('(none)');
    });

    it('throws an error with message prefixed by "getAvailableSkillNames failed:" when something in the function fails', async () => {
      await expect(
        getAvailableSkillNames({
          flags: {
            enabledSkills: {
              has: () => {
                throw new Error('enabledSkills filter threw');
              },
            } as unknown as Set<string>,
            disabledSkills: null,
          },
        }),
      ).rejects.toThrow(
        'getAvailableSkillNames failed: enabledSkills filter threw',
      );
    });
  });

  describe('listSkills and viewSkillContent (skills-api-test-plan)', () => {
    it('list all skills: returns a string containing available_skills and all loaded skill names', async () => {
      const result = await listSkills({});
      expect(result).toContain('<available_skills>');
      expect(result).toContain('first-skill');
      expect(result).toContain('second-skill');
      const inner = result
        .split('<available_skills>')[1]
        .split('</available_skills>')[0];
      const lines = inner.trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('read valid skill: returns the content of the skill SKILL.md when name and path are valid', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: 'SKILL.md',
      });
      expect(result).toBe('First skill content\n');
    });

    it('skill not found: viewSkillContent throws SkillsApiError SKILL_NOT_FOUND', async () => {
      try {
        await viewSkillContent({ name: 'nonexistent-skill', path: 'SKILL.md' });
        throw new Error('Expected SkillsApiError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillsApiError);
        expect((err as SkillsApiError).code).toBe('SKILL_NOT_FOUND');
        expect((err as SkillsApiError).details?.name).toBe('nonexistent-skill');
      }
    });

    it('skill not found with another name: throws SkillsApiError SKILL_NOT_FOUND', async () => {
      try {
        await viewSkillContent({
          name: 'another-missing-skill',
          path: 'SKILL.md',
        });
        throw new Error('Expected SkillsApiError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillsApiError);
        expect((err as SkillsApiError).details?.name).toBe(
          'another-missing-skill',
        );
      }
    });

    it('path not found inside valid skill: viewSkillContent throws SkillsApiError PATH_NOT_FOUND', async () => {
      try {
        await viewSkillContent({
          name: 'first-skill',
          path: 'indexing-strategies',
        });
        throw new Error('Expected SkillsApiError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillsApiError);
        expect((err as SkillsApiError).code).toBe('PATH_NOT_FOUND');
        expect((err as SkillsApiError).details?.skill).toBe('first-skill');
        expect((err as SkillsApiError).details?.listing).toContain('SKILL.md');
      }
    });

    it('invalid path directory traversal: viewSkillContent throws SkillsApiError INVALID_PATH', async () => {
      try {
        await viewSkillContent({
          name: 'first-skill',
          path: '../../etc/passwd',
        });
        throw new Error('Expected SkillsApiError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillsApiError);
        expect((err as SkillsApiError).code).toBe('INVALID_PATH');
      }
    });

    it('invalid path with null byte: viewSkillContent throws SkillsApiError INVALID_PATH', async () => {
      await expect(
        viewSkillContent({
          name: 'first-skill',
          path: 'SKILL.md\x00.txt',
        }),
      ).rejects.toThrow(SkillsApiError);
    });
  });
});
