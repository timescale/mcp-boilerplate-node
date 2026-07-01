import { describe, expect, it } from 'bun:test';
import Path from 'node:path';
import {
  getAvailableSkillNames,
  InvalidPathError,
  listSkills,
  PathNotFoundError,
  SkillNotFoundError,
  viewSkillContent,
} from './utils.js';

process.env.SKILLS_FILE = Path.resolve(
  import.meta.dir,
  '__fixtures__',
  'skills.yaml',
);

describe('Skills API', () => {
  describe('getAvailableSkillNames', () => {
    it('returns a comma-separated list of visible skill names in alphabetical order when skills are loaded', async () => {
      const names = await getAvailableSkillNames({});
      expect(names).toBe(
        'collection-a, collection-b, first-skill, second-skill',
      );
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
      expect(result).toContain('collection-a');
      expect(result).toContain('collection-b');
      const inner = result
        .split('<available_skills>')[1]
        .split('</available_skills>')[0];
      const lines = inner.trim().split('\n');
      expect(lines).toHaveLength(5);
    });

    it('read valid skill: returns the content of the skill SKILL.md when name and path are valid', async () => {
      const result = await viewSkillContent({
        name: 'first-skill',
        path: 'SKILL.md',
      });
      expect(result).toBe('First skill content\n');
    });

    it('skill not found: viewSkillContent throws SkillNotFoundError', async () => {
      try {
        await viewSkillContent({ name: 'nonexistent-skill', path: 'SKILL.md' });
        throw new Error('Expected SkillNotFoundError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillNotFoundError);
        expect((err as SkillNotFoundError).skillName).toBe('nonexistent-skill');
      }
    });

    it('skill not found with another name: throws SkillNotFoundError', async () => {
      try {
        await viewSkillContent({
          name: 'another-missing-skill',
          path: 'SKILL.md',
        });
        throw new Error('Expected SkillNotFoundError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SkillNotFoundError);
        expect((err as SkillNotFoundError).skillName).toBe(
          'another-missing-skill',
        );
      }
    });

    it('path not found inside valid skill: viewSkillContent throws PathNotFoundError', async () => {
      try {
        await viewSkillContent({
          name: 'first-skill',
          path: 'indexing-strategies',
        });
        throw new Error('Expected PathNotFoundError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PathNotFoundError);
        expect((err as PathNotFoundError).skill).toBe('first-skill');
        expect((err as PathNotFoundError).path).toBe('indexing-strategies');
        expect((err as PathNotFoundError).listing).toContain('SKILL.md');
      }
    });

    it('invalid path directory traversal: viewSkillContent throws InvalidPathError', async () => {
      try {
        await viewSkillContent({
          name: 'first-skill',
          path: '../../etc/passwd',
        });
        throw new Error('Expected InvalidPathError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPathError);
        expect((err as InvalidPathError).path).toBe('../../etc/passwd');
      }
    });

    it('invalid path with null byte: viewSkillContent throws InvalidPathError', async () => {
      await expect(
        viewSkillContent({
          name: 'first-skill',
          path: 'SKILL.md\x00.txt',
        }),
      ).rejects.toThrow(InvalidPathError);
    });
  });

  describe('local_collection', () => {
    it('loads every real skill directory inside the collection', async () => {
      const names = await getAvailableSkillNames({});
      expect(names).toContain('collection-a');
      expect(names).toContain('collection-b');
    });

    it('exposes collection skill content via viewSkillContent', async () => {
      const result = await viewSkillContent({
        name: 'collection-a',
        path: 'SKILL.md',
      });
      expect(result).toBe('Collection skill A content\n');
    });

    it('skips dot-prefixed directories (e.g. .github) even when they contain a valid SKILL.md', async () => {
      const names = await getAvailableSkillNames({});
      expect(names).not.toContain('dot-github-trap');
      await expect(
        viewSkillContent({ name: 'dot-github-trap', path: 'SKILL.md' }),
      ).rejects.toBeInstanceOf(SkillNotFoundError);
    });
  });
});
