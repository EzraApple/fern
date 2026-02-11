---
name: adding-skills
description: How to create new OpenCode skills for the Fern agent. Reference when adding reusable instruction sets that teach the agent new workflows or domain knowledge.
---

# Adding Skills

Skills are reusable Markdown instruction files that the agent can load on-demand via the built-in `skill` tool. They provide specialized knowledge, step-by-step guidance, or workflow instructions.

## When to use skills vs tools

- **Skills** = knowledge/instructions (Markdown, read by the agent)
- **Tools** = executable actions (TypeScript, called by the agent)
- **MCPs** = external tool servers (configured in `opencode.jsonc`)

Use a skill when you want the agent to _know how_ to do something. Use a tool when you want the agent to _do_ something.

## File structure

Each skill is a folder containing a single `SKILL.md` file:

```
src/.opencode/skill/<skill-name>/SKILL.md
```

## SKILL.md format

```markdown
---
name: my-skill-name
description: One-line description of when to use this skill. Shown to the LLM in the skill tool's description.
---

# Skill Title

## When to use

- Bullet points describing when this skill applies

## Instructions

Step-by-step guidance, code examples, patterns, etc.
```

### Required frontmatter fields

| Field | Rules |
|-------|-------|
| `name` | Lowercase alphanumeric with single hyphens. Must match the directory name. Regex: `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description` | 1-1024 characters. Shown to the LLM so it knows when to load the skill. |

### Optional frontmatter fields

| Field | Purpose |
|-------|---------|
| `license` | License identifier (e.g., `MIT`) |
| `compatibility` | Runtime compatibility (e.g., `opencode`) |
| `metadata` | Key-value pairs for additional context |

## Naming rules

- Lowercase letters, digits, and single hyphens only
- No leading, trailing, or consecutive hyphens
- Must match the containing directory name exactly
- Examples: `adding-tools`, `git-workflow`, `api-design`

## Discovery locations (checked in order)

1. `src/.opencode/skill/<name>/SKILL.md` — project-level (Fern uses this)
2. `src/.opencode/skills/<name>/SKILL.md` — also works (plural)
3. `~/.config/opencode/skills/<name>/SKILL.md` — global OpenCode skills
4. `~/.claude/skills/<name>/SKILL.md` — global Claude Code skills
5. Custom paths via `config.skills.paths` in `opencode.jsonc`

## How skills are used at runtime

1. OpenCode discovers all `SKILL.md` files at startup
2. The built-in `skill` tool lists available skills (name + description) in its own description
3. Agent calls `skill({ name: "adding-skills" })` to load the full content
4. The Markdown content is returned to the agent's context
5. Agent follows the instructions in the skill

## Writing effective skills

### The description field is everything

The `description` in YAML frontmatter is the **only thing the LLM sees** before deciding whether to load the skill. The actual content is only loaded _after_ the model calls the `skill` tool. This means:

- The description must clearly state **when** to use the skill, not just what it contains
- Use action-oriented language that matches how requests are phrased: "Reference when adding new tools", "Use when implementing channel adapters"
- Keep it under ~150 characters — descriptions get concatenated into the skill tool's description alongside every other skill. Bloated descriptions waste context on every turn.
- Think about what task phrasing would make the model reach for this skill. If someone says "add a new tool", will your description match that intent?

**Good descriptions:**
- `How to create new OpenCode tools for the Fern agent. Reference when implementing executable actions using the OpenCode plugin format.`
- `Git branching conventions and PR workflow. Use when creating branches, writing commit messages, or submitting PRs.`

**Bad descriptions:**
- `This skill contains information about tools` (too vague, no trigger condition)
- `A comprehensive guide to the complete tool creation process including all schema types, HTTP proxy patterns, anti-patterns, testing strategies, and deployment considerations` (too long, wastes context)

### Content best practices

- Start with a "When to use" section so the agent confirms it loaded the right skill
- Include concrete code examples, not just abstract guidance
- Reference actual file paths in the Fern codebase where relevant
- Keep skills focused — one workflow or concept per skill
- Include anti-patterns ("Don't do X") alongside patterns
- Include a "Current state" table (e.g., list of existing tools, skills, MCPs) so the agent has context on what already exists
- Write for an agent that has no memory of previous sessions — each skill load is a fresh context injection

## Example: Creating a new skill

To add a skill called `api-design`:

1. Create directory: `src/.opencode/skill/api-design/`
2. Create `SKILL.md` with frontmatter (`name: api-design`, `description: ...`)
3. Write the skill content
4. Restart OpenCode (skills are discovered at startup)
5. Test: ask the agent to use the `skill` tool with `name: "api-design"`

## Current skills

| Skill | Purpose |
|-------|---------|
| `adding-skills` | This skill — how to create new skills |
| `adding-mcps` | How to configure MCP servers |
| `adding-tools` | How to create new OpenCode tools |
