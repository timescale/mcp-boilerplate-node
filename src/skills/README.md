# Skills

Utilities to emulate Claude Skills with any LLM via a [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) tools/resources.

## What are Skills?

Skills are modular components that enhance the capabilities of an MCP-compatible agent by providing specific functionalities, workflows, and domain expertise. They transform a general-purpose agent into a specialized agent equipped with procedural knowledge that no model can fully possess.

The goal is to be fully compatible with Anthropic's skill format. See their [Agent Skills Spec](https://github.com/anthropics/skills/blob/main/agent_skills_spec.md) and related documentation for more details.

<details>
<summary><strong>An overview of the Skills spec</strong></summary>

### Skill Structure

Skills are modular, self-contained packages that extend agent capabilities by providing
specialized knowledge, workflows, and tools. Think of them as "onboarding guides" for specific
domains or tasks—they transform the agent from a general-purpose agent into a specialized agent
equipped with procedural knowledge that no model can fully possess.

### What Skills Provide

1. Specialized workflows - Multi-step procedures for specific domains
2. Tool integrations - Instructions for working with specific file formats or APIs
3. Domain expertise - Company-specific knowledge, schemas, business logic
4. Bundled resources - Scripts, references, and assets for complex and repetitive tasks

### Anatomy of a Skill

Every skill consists of a required SKILL.md file and optional bundled resources:

```text
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Python/Bash/etc.)
    ├── references/       - Documentation intended to be loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
```

#### SKILL.md (required)

**Metadata Quality:** The `name` and `description` in YAML frontmatter determine when the agent will use the skill. Be specific about what the skill does and when to use it. Use the third-person (e.g. "This skill should be used when..." instead of "Use this skill when...").

#### Bundled Resources (optional)

##### Scripts (`scripts/`)

Executable code (Python/Bash/etc.) for tasks that require deterministic reliability or are repeatedly rewritten.

- **When to include**: When the same code is being rewritten repeatedly or deterministic reliability is needed
- **Example**: `scripts/rotate_pdf.py` for PDF rotation tasks
- **Benefits**: Token efficient, deterministic, may be executed without loading into context
- **Note**: Scripts may still need to be read by the agent for patching or environment-specific adjustments

##### References (`references/`)

Documentation and reference material intended to be loaded as needed into context to inform the agent's process and thinking.

- **When to include**: For documentation that the agent should reference while working
- **Examples**: `references/finance.md` for financial schemas, `references/mnda.md` for company NDA template, `references/policies.md` for company policies, `references/api_docs.md` for API specifications
- **Use cases**: Database schemas, API documentation, domain knowledge, company policies, detailed workflow guides
- **Benefits**: Keeps SKILL.md lean, loaded only when the agent determines it's needed
- **Best practice**: If files are large (>10k words), include grep search patterns in SKILL.md
- **Avoid duplication**: Information should live in either SKILL.md or references files, not both. Prefer references files for detailed information unless it's truly core to the skill—this keeps SKILL.md lean while making information discoverable without hogging the context window. Keep only essential procedural instructions and workflow guidance in SKILL.md; move detailed reference material, schemas, and examples to references files.

##### Assets (`assets/`)

Files not intended to be loaded into context, but rather used within the output the agent produces.

- **When to include**: When the skill needs files that will be used in the final output
- **Examples**: `assets/logo.png` for brand assets, `assets/slides.pptx` for PowerPoint templates, `assets/frontend-template/` for HTML/React boilerplate, `assets/font.ttf` for typography
- **Use cases**: Templates, images, icons, boilerplate code, fonts, sample documents that get copied or modified
- **Benefits**: Separates output resources from documentation, enables the agent to use files without loading them into context

### Progressive Disclosure Design Principle

Skills use a three-level loading system to manage context efficiently:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed by the agent (Unlimited\*)

\*Unlimited because scripts can be executed without reading into context window.

</details>

## Usage

Add skills to your MCP server by configuring the skills tool and/or resources, and configuring a set of skills to include.

### View Skill Tool

Use `createViewSkillToolFactory` to register with `httpServerFactory` as a tool.

```typescript
import { httpServerFactory } from '@tigerdata/mcp-boilerplate';
import { createViewSkillToolFactory } from '@tigerdata/mcp-boilerplate/skills';

await httpServerFactory({
  apiFactories: [
    createViewSkillToolFactory(),
  ],
});
```

### Skills Resources

Use `createSkillsResourceFactory` to register with `httpServerFactory` as a dynamic set of templated resources.

```typescript
import { httpServerFactory } from '@tigerdata/mcp-boilerplate';
import { createSkillsResourceFactory } from '@tigerdata/mcp-boilerplate/skills';
await httpServerFactory({
  resourceFactories: [
    createSkillsResourceFactory(),
  ],
});
```

## Configuration

### Environment Variables

- `SKILLS_FILE`: Path to the YAML file configuring the set of skills. Default: `./skills.yaml`
- `SKILLS_TTL`: Time (in milliseconds) to cache loaded skills. Default: 5 minutes

### Skills Configuration File

The set of skills is configured via a YAML file. Both local directories and GitHub repositories are supported. Config can point to individual skills or collections of skills.

```yaml
local-directory-collection:
  # A collection of local skills stored in the `./skills` directory.
  # Each skill should be in its own subdirectory with a `SKILL.md` file.
  type: local_collection
  path: ./skills
local-individual-skill:
  # An individual local skill stored in the `./skills/skill-name` directory.
  type: local
  path: ./path-to/individual/skill-name
anthropic-github-collection:
  # A GitHub repo containing a collection of skills.
  # Each skill should be in its own subdirectory with a `SKILL.md` file.
  type: github_collection
  repo: anthropics/skills
  # path: ./ # not needed for this example since skills are at the root of the repo
  # Optionally specify skills/paths to ignore in this collection
  ignored_paths:
    - .claude-plugin
    - document-skills
  disabled_skills:
    - canvas-design
  # Setting enabled_skills will _only_ load the specified skills from the collection
  # enabled_skills:
  #   - frontend-design
  #   - webapp-testing
single-github-skill-example:
  # A GitHub repo containing an individual skill.
  type: github
  repo: anthropics/claude-cookbooks
  path: ./skills/custom_skills/creating-financial-models
```

Skill names must be unique across all configured skills. Any duplicates will be ignored with a warning.

### Connection string parameters

Individual clients can control the set of skills that are enabled, as well as the protocol(s) used, via parameters in the connection string.

- `enabled_skills`: Comma-separated list of skill keys to enable. If not provided, all configured skills are enabled.
- `disabled_skills`: Comma-separated list of skill keys to disable. If not provided, no skills are disabled.
- `tools=0`: Disable all tools (for resource-only integration).
- `resources=0`: Disable all resources (for tool-only integration).

#### Example

```text
http://mcp-server/mcp?disabled_skills=foo,bar&resources=0
```
