import { readdir, readFile, stat } from 'node:fs/promises';
import Path from 'node:path';
import type { Octokit } from '@octokit/rest';
import {
  log,
  type McpFeatureFlags,
  type ParsedQs,
} from '@tigerdata/mcp-boilerplate';
import { encode } from '@toon-format/toon';
import matter from 'gray-matter';
import YAML from 'yaml';
import {
  type CollectionFlags,
  type CollectionFlagsCfg,
  type GitHubSkill,
  type LocalSkill,
  type Skill,
  type SkillCfgMap,
  type SkillMatter,
  type SkillsFlags,
  zSkillCfgMap,
  zSkillMatter,
} from './types.js';

const TTL = process.env.SKILLS_TTL
  ? parseInt(process.env.SKILLS_TTL, 10)
  : 5 * 60 * 1000;

let lastFetchCfg = 0;
let skillCfgMap: SkillCfgMap | null = null;
export const getSkillConfig = async (
  configFilePath = process.env.SKILLS_FILE || './skills.yaml',
): Promise<SkillCfgMap> => {
  if (skillCfgMap && Date.now() - lastFetchCfg < TTL) return skillCfgMap;

  const data = await readFile(configFilePath, 'utf-8');
  skillCfgMap = zSkillCfgMap.parse(YAML.parse(data));
  lastFetchCfg = Date.now();

  return skillCfgMap;
};

export const parseSkillFile = async (
  fileContent: string,
): Promise<{
  matter: SkillMatter;
  content: string;
}> => {
  const { data, content } = matter(fileContent);
  const skillMatter = zSkillMatter.parse(data);
  if (!/^[a-zA-Z0-9-_]+$/.test(skillMatter.name)) {
    const normalized = skillMatter.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '_')
      .replace(/-[-_]+/g, '-')
      .replace(/_[_-]+/g, '_')
      .replace(/(^[-_]+)|([-_]+$)/g, '');
    log.warn(
      `Skill name "${skillMatter.name}" contains invalid characters. Normalizing to "${normalized}".`,
    );
    skillMatter.name = normalized;
  }
  return {
    matter: skillMatter,
    content,
  };
};

// skill name/path -> content
const skillContentCache: Map<string, string> = new Map();

let lastFetchSkillMap = 0;
let skillMap: Promise<Map<string, Skill>> | null = null;
export const loadSkills = async ({
  octokit,
  force = false,
}: {
  octokit?: Octokit | null;
  force?: boolean;
} = {}): Promise<Map<string, Skill>> => {
  if (skillMap && !force && Date.now() - lastFetchSkillMap < TTL)
    return skillMap;
  skillMap = doLoadSkills(octokit).then(
    (result) => {
      lastFetchSkillMap = Date.now();
      return result;
    },
    (err) => {
      log.error('Failed to load skills, returning empty skill map', err);
      skillMap = null;
      return new Map<string, Skill>();
    },
  );
  return skillMap;
};

const doLoadSkills = async (
  octokit?: Octokit | null,
): Promise<Map<string, Skill>> => {
  const skillCfgs = await getSkillConfig();

  skillContentCache.clear();
  const skills = new Map<string, Skill>();

  const alreadyExists = (
    name: string,
    path: string,
    description: string,
  ): boolean => {
    const existing = skills.get(name);
    if (existing) {
      log.warn(
        `Skill with name "${name}" already loaded from path "${existing.path}". Skipping duplicate at path "${path}".`,
        { existing, duplicate: { path, name, description } },
      );
      return true;
    }
    return false;
  };

  const shouldIgnorePath = (path: string, flags?: CollectionFlags): boolean => {
    if (flags?.ignoredPaths?.has(path)) {
      log.debug(`Ignoring path "${path}" in ignoredPaths`);
      return true;
    }
    return false;
  };

  const shouldIgnoreSkill = (
    name: string,
    flags?: CollectionFlags,
  ): boolean => {
    if (flags?.enabledSkills && !flags.enabledSkills.has(name)) {
      log.debug(`Ignoring skill "${name}" not in enabledSkills`);
      return true;
    }
    if (flags?.disabledSkills?.has(name)) {
      log.debug(`Ignoring skill "${name}" in disabledSkills`);
      return true;
    }
    return false;
  };

  const loadLocalPath = async (
    path: string,
    flags?: CollectionFlags,
  ): Promise<void> => {
    if (shouldIgnorePath(path, flags)) return;
    const skillPath = `${path}/SKILL.md`;
    try {
      const fileContent = await readFile(skillPath, 'utf-8');
      const {
        matter: { name, description },
        content,
      } = await parseSkillFile(fileContent);
      if (shouldIgnoreSkill(name, flags)) return;
      if (alreadyExists(name, path, description)) return;
      skills.set(name, {
        type: 'local',
        path,
        name,
        description,
      } satisfies LocalSkill);
      skillContentCache.set(`${name}/SKILL.md`, content);
    } catch (err) {
      log.error(`Failed to load skill at path: ${skillPath}`, err as Error);
    }
  };

  const loadGitHubPath = async (
    owner: string,
    repo: string,
    path: string,
    flags?: CollectionFlags,
  ): Promise<void> => {
    if (shouldIgnorePath(path, flags)) return;
    const skillPath = `${path}/SKILL.md`;
    if (!octokit) {
      log.error(
        `Octokit instance is required to load GitHub skills: ${owner}/${repo}/${skillPath}`,
      );
      return;
    }
    try {
      const skillFileResponse = await octokit.repos.getContent({
        owner,
        repo,
        path: skillPath,
      });
      if (
        Array.isArray(skillFileResponse.data) ||
        skillFileResponse.data.type !== 'file'
      ) {
        log.error(`Expected SKILL.md to be a file`, null, {
          owner,
          repo,
          path: skillPath,
        });
        return;
      }
      const fileContent = Buffer.from(
        skillFileResponse.data.content,
        'base64',
      ).toString('utf-8');
      const {
        matter: { name, description },
        content,
      } = await parseSkillFile(fileContent);
      if (shouldIgnoreSkill(name, flags)) return;
      if (alreadyExists(name, path, description)) return;
      skills.set(name, {
        type: 'github',
        repo: `${owner}/${repo}`,
        path,
        name,
        description,
      } satisfies GitHubSkill);
      skillContentCache.set(`${name}/SKILL.md`, content);
    } catch (err) {
      log.error(
        `Failed to load skill at GitHub path: ${owner}/${repo}/${skillPath}\n${(err as Error).message}`,
      );
    }
  };

  const promises: Promise<void>[] = [];
  await Promise.all(
    Object.entries(skillCfgs).map(async ([name, cfg]) => {
      try {
        switch (cfg.type) {
          case 'local': {
            promises.push(loadLocalPath(cfg.path));
            break;
          }
          case 'local_collection': {
            const dirEntries = await readdir(cfg.path, {
              withFileTypes: true,
            });
            const flags = parseCollectionFlags(cfg);
            for (const entry of dirEntries) {
              if (entry.isFile()) continue;
              if (!entry.isDirectory()) {
                log.warn(`Skipping non-directory entry in local_collection`, {
                  path: `${cfg.path}/${entry.name}`,
                });
                continue;
              }
              promises.push(loadLocalPath(`${cfg.path}/${entry.name}`, flags));
            }
            break;
          }
          case 'github': {
            const [owner, repo] = cfg.repo.split('/');
            if (!owner || !repo) {
              log.error(
                `Invalid GitHub repo format in skill config: ${cfg.repo}`,
                null,
                { name, repo: cfg.repo },
              );
              break;
            }
            promises.push(loadGitHubPath(owner, repo, cfg.path || '.'));
            break;
          }
          case 'github_collection': {
            const [owner, repo] = cfg.repo.split('/');
            if (!owner || !repo) {
              log.error(
                `Invalid GitHub repo format in skill config: ${cfg.repo}`,
                null,
                { name, repo: cfg.repo },
              );
              break;
            }
            if (!octokit) {
              log.error(
                `Octokit instance is required to load GitHub collection skills: ${cfg.repo}`,
              );
              break;
            }
            const rootPath = cfg.path
              ? cfg.path.replace(/(^\.?\/+)|(^\.$)|(\/\.$)/g, '')
              : '';
            const dirResponse = await octokit.repos.getContent({
              owner,
              repo,
              path: rootPath,
            });
            if (!Array.isArray(dirResponse.data)) {
              log.error(
                `Expected github_collection repo path to be a directory`,
                null,
                { name, owner, repo, path: cfg.path || '.' },
              );
              break;
            }
            const flags = parseCollectionFlags(cfg);
            for (const entry of dirResponse.data) {
              if (entry.type === 'file') continue;
              if (entry.type !== 'dir') {
                log.warn(`Skipping non-directory entry in github_collection`, {
                  path: `${cfg.repo}/${entry.path}`,
                  type: entry.type,
                });
                continue;
              }
              promises.push(loadGitHubPath(owner, repo, entry.path, flags));
            }
            break;
          }
          default: {
            // @ts-expect-error exhaustive check
            throw new Error(`Unhandled skill config type: ${cfg.type}`);
          }
        }
      } catch (err) {
        log.error(`Failed to load skill config "${name}"`, err as Error);
      }
    }),
  );
  await Promise.all(promises);

  // Sort skills by name
  return new Map(
    Array.from(skills.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  );
};

export const resolveSkill = async ({
  name,
  octokit,
  flags = {},
  force = false,
}: {
  name: string;
  octokit?: Octokit | null;
  flags?: SkillsFlags;
  force?: boolean;
}): Promise<Skill | null> => {
  if (!skillVisible(name, flags)) {
    return null;
  }
  const skills = await loadSkills({ octokit, force });
  return skills.get(name) || null;
};

export const skillVisible = (name: string, flags: SkillsFlags): boolean => {
  if (flags.enabledSkills && !flags.enabledSkills.has(name)) {
    return false;
  }
  if (flags.disabledSkills?.has(name)) {
    return false;
  }
  return true;
};

export const listSkills = async ({
  octokit,
  flags = {},
  force = false,
}: {
  octokit?: Octokit | null;
  flags?: SkillsFlags;
  force?: boolean;
} = {}): Promise<string> => {
  const skills = await loadSkills({ octokit, force });
  return `<available_skills>
${encode(
  [...skills.values()]
    .filter((s) => skillVisible(s.name, flags))
    .map((s) => ({
      name: s.name,
      description: s.description,
    })),
  { delimiter: '\t' },
)}
</available_skills>`;
};

export const viewSkillContent = async ({
  octokit,
  flags = {},
  name,
  path: passedPath,
}: {
  octokit?: Octokit | null;
  flags?: SkillsFlags;
  name: string;
  path?: string;
}): Promise<string> => {
  const skill = await resolveSkill({ octokit, flags, name });
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }

  const targetPath = passedPath || 'SKILL.md';
  const cacheKey = `${name}/${targetPath}`;
  const cached = skillContentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const content = await getSkillContent({ octokit, skill, path: targetPath });
  skillContentCache.set(cacheKey, content);
  return content;
};

const getSkillContent = async ({
  skill,
  path: targetPath,
  octokit,
}: {
  skill: Skill;
  path: string;
  octokit?: Octokit | null;
}): Promise<string> => {
  const normalizedPath = Path.posix
    .normalize(
      // treat \ as /
      targetPath.replace(/\\/g, '/'),
    )
    // strip leading ./ or /
    .replace(/^\/+/, '')
    .replace(/^(\.\/)+/, '');
  if (
    normalizedPath.split('/').some((s) => s === '..') ||
    normalizedPath.includes('\0')
  ) {
    throw new Error(`Invalid path: ${targetPath}`);
  }
  switch (skill.type) {
    case 'local': {
      const root = Path.resolve(skill.path);
      const target = Path.resolve(Path.join(root, normalizedPath));
      if (targetPath !== '.' && !target.startsWith(root)) {
        throw new Error(`Invalid path: ${targetPath}`);
      }
      const s = await stat(target).catch(() => {
        throw new Error(`Path not found: ${targetPath}`);
      });
      if (s.isDirectory()) {
        const entries = await readdir(target, {
          withFileTypes: true,
        });
        const listing = entries
          .map((entry) => {
            return `${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`;
          })
          .join('\n');
        return `Directory listing for ${skill.name}/${normalizedPath}:\n${listing}`;
      } else if (s.isFile()) {
        return await readFile(target, 'utf-8');
      } else {
        throw new Error(`Unsupported file type at path: ${target}`);
      }
    }
    case 'github': {
      const [owner, repo] = skill.repo.split('/');
      if (!owner || !repo) {
        throw new Error(`Invalid GitHub repo format in skill: ${skill.repo}`);
      }
      const path = `${skill.path || '.'}/${normalizedPath}`
        .replace(/\/+/g, '/')
        .replace(/(^\.?\/+)|(^\.$)|(\/\.$)/g, '');
      if (!octokit) {
        throw new Error(
          `Octokit instance is required to load GitHub skill content: ${owner}/${repo}/${path}`,
        );
      }
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path,
      });
      if (Array.isArray(response.data)) {
        // Directory listing
        const listing = response.data
          .map((entry) => {
            return `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`;
          })
          .join('\n');
        return `Directory listing for ${skill.name}/${normalizedPath}:\n${listing}`;
      }
      if (response.data.type !== 'file') {
        throw new Error(`Unsupported content type: ${response.data.type}`);
      }
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    }
    default: {
      // @ts-expect-error exhaustive check
      throw new Error(`Unhandled skill type: ${skill.type}`);
    }
  }
};

export const skillsDescription = `
# Skills

This tool provides access to domain-specific skills - structured knowledge and procedures for specialized tasks.

## How to Use Skills

1. **Discover**: If you have not been provided the list of skills, fetch them by invoking this tool with \`name: "."\`
2. **Read**: Access a skill by reading its SKILL.md file: \`name: "skill-name", path: "SKILL.md"\`
3. **Explore**: Navigate within the skill directory to find additional resources, examples, or templates.
   The SKILL.md file and other documents may contain relative links to guide you.
   You can list the content of directories by specifying the directory path, relative to the skill root.
4. **Apply**: Follow the procedures and reference the knowledge in the skill to complete your task

## Skill Structure

Each skill contains:
- **SKILL.md**: Main documentation (always start here)
- **REFERENCE.md**: Quick reference card (optional)
- Additional files: Examples, templates, scripts

## When to Use Skills

- Read relevant skills proactively when you identify a task that matches a skill's domain
- Skills are meant to augment your knowledge, not replace your reasoning
- Apply skill guidance while adapting to the specific user request
- Skills use progressive disclosure - start with high-level guidance and drill down only as needed
- Skills may also refer to tools or resources external to the skill itself
- Use other tools to execute any code or scripts provided by the skill
`.trim();

const toSet = (flag: ParsedQs[string]): Set<string> | null =>
  flag
    ? Array.isArray(flag)
      ? new Set(flag as string[])
      : typeof flag === 'string'
        ? new Set(flag.split(',').map((s) => s.trim()))
        : null
    : null;

export const parseSkillsFlags = (
  query: McpFeatureFlags['query'],
): SkillsFlags => ({
  enabledSkills: toSet(query?.enabled_skills),
  disabledSkills: toSet(query?.disabled_skills),
});

export const parseCollectionFlags = (
  cfg: CollectionFlagsCfg,
): CollectionFlags => ({
  enabledSkills: toSet(cfg.enabled_skills),
  disabledSkills: toSet(cfg.disabled_skills),
  ignoredPaths: toSet(cfg.ignored_paths),
});
