import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Path from 'node:path';
import {
  getAvailableSkillNames,
  listSkills,
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
      ).rejects.toThrow('getAvailableSkillNames failed: enabledSkills filter threw');
    });
  });

  describe('listSkills and viewSkillContent (skills-api-test-plan)', () => {
    it('list all skills: returns a string containing available_skills and all loaded skill names', async () => {
      const result = await listSkills({});
      expect(result).toContain('<available_skills>');
      expect(result).toContain('first-skill');
      expect(result).toContain('second-skill');
    });

    it('read valid skill: returns the content of the skill SKILL.md when name and path are valid', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: 'SKILL.md',
      });
      expect(result).toContain('First skill content');
    });

    it('skill not found: returns a recovery string with the requested name and available skill names when the skill does not exist', async () => {
      const result = await viewSkillContent({
        name: 'nonexistent-skill',
        path: 'SKILL.md',
      });
      expect(result).toContain('Skill not found: nonexistent-skill.');
      expect(result).toContain('Available skills:');
      expect(result).toContain('first-skill');
      expect(result).toContain('second-skill');
      expect(result).toContain('Use one of these names.');
    });

    it('skill not found with another name: returns the same recovery pattern for a different missing skill name', async () => {
      const result = await viewSkillContent({
        name: 'another-missing-skill',
        path: 'SKILL.md',
      });
      expect(result).toContain('Skill not found: another-missing-skill.');
      expect(result).toContain('Available skills:');
      expect(result).toContain('Use one of these names.');
    });

    it('path not found inside valid skill: returns a recovery string with path not found, skill name, directory listing and hint to use SKILL.md', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: 'indexing-strategies',
      });
      expect(result).toContain('Path not found: indexing-strategies.');
      expect(result).toContain('Contents of skill "first-skill"');
      expect(result).toContain('SKILL.md');
      expect(result).toContain('Use path "SKILL.md" to read the main skill document.');
    });

    it('invalid path directory traversal: returns a recovery string containing Invalid path and available skills when path attempts traversal', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: '../../etc/passwd',
      });
      expect(result).toContain('Invalid path: ../../etc/passwd');
      expect(result).toContain('Available skills:');
      expect(result).toContain('Use name "." to list skills');
      expect(result).toContain('use path "." to list a skill\'s contents');
    });

    it('invalid path with null byte: returns a recovery string and does not throw when path contains null byte', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: 'SKILL.md\x00.txt',
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(
        result.includes('Path not found:') || result.includes('Invalid path:'),
      ).toBe(true);
    });
  });
});
