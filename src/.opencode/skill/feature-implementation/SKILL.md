---
name: feature-implementation
description: Workflow for implementing features or fixes in Fern's codebase. MUST load before any self-improvement PR changing 2+ files.
---

# Feature Implementation

You are implementing a feature or fix in Fern's own codebase. Follow these phases strictly. Do NOT skip phases or reorder them.

## Phase 1: Understand

Before writing any code or creating any tasks, you MUST understand the existing code.

### 1a. Identify affected areas

Think about which parts of the codebase this feature touches. Use `agent-docs/codebase-navigation.md` or refer to:
- **Message handling**: `src/core/agent.ts`, `src/server/webhooks.ts`
- **Channel adapters**: `src/channels/whatsapp/adapter.ts`, `src/channels/types.ts`
- **HTTP routes**: `src/server/server.ts`, `src/server/*-api.ts`
- **Tools**: `src/.opencode/tool/*.ts`
- **System prompt**: `config/SYSTEM_PROMPT.md`, `src/core/prompt.ts`
- **Database/storage**: `src/memory/db/*.ts`
- **Types**: Look for `types.ts` in the relevant module directory

### 1b. Read the files you plan to modify

For EACH file you think you'll need to change, read it NOW. Not later. Understand:
- What it exports (and who imports those exports)
- What patterns it uses
- Where your changes would fit

Use `read` to view files directly. Use `explore` subagents for broad searches when you don't know where to look. But read the key files yourself — you need to understand them to make good changes.

### 1c. Research unfamiliar external APIs

If the feature involves an external service, API, or library you haven't worked with before, research it BEFORE planning changes. Use `research` subagents or load the `web-research` skill to understand:
- What data format the API sends/receives
- Authentication requirements
- Edge cases and error responses

Don't assume how an external API works. Verify it.

### 1d. Look at similar features

Before implementing, find how similar things were done before:
- Adding a new tool? Read an existing tool in `src/.opencode/tool/`
- Changing a channel? Read `src/channels/whatsapp/adapter.ts`
- Adding an API endpoint? Read `src/server/memory-api.ts`
- Adding to the database? Read `src/memory/db/memories.ts`

### 1e. Wait for results

If you spawned explore or research subagents, WAIT for their results before proceeding. Do NOT create tasks while explorations are running. The results inform the plan.

**End of Phase 1 checkpoint**: You should now be able to answer:
- Which existing files need to be modified? (list them)
- What pattern does each file follow?
- Are there existing types/interfaces to extend?
- What is the minimal set of changes needed?
- Do I understand the external APIs involved?

## Phase 2: Plan

NOW create tasks. Each task should be specific and reference actual files.

### 2a. Design the minimal change set

The best PRs change as little as possible. For each change, ask:
- Can I extend an existing type/interface instead of creating a new one?
- Can I add to an existing file instead of creating a new one?
- Can I reuse an existing pattern instead of inventing a new one?

### 2b. Create tasks

Use `task_create` for each step. Each task should specify:
- Which file(s) to modify
- What to change in each file
- What pattern to follow (reference the similar feature from Phase 1)

Good tasks reference specific files and patterns. Bad tasks are vague ("implement X support").

### 2c. Order by dependency

Put foundation changes first (types, interfaces), then implementation, then wiring (routes, config):
1. Extend types/interfaces
2. Modify core logic
3. Add/update tools or API endpoints
4. Wire up routes or config
5. Update system prompt if needed

### 2d. Keep it to 3-7 tasks

If you have more than 7, you're over-planning or the feature is too large for one PR.

## Phase 3: Implement

Work through tasks sequentially using `task_next`.

### Rules for every file modification:

1. **Read before write**: Read the file first, even if you read it in Phase 1. The workspace is a fresh clone — confirm the state.
2. **Edit, don't replace**: Use `edit` to modify specific sections. Use `write` only for genuinely new files.
3. **Follow the file's existing style**: Match indentation, naming, imports, error handling patterns.
4. **Change only what's needed**: Don't refactor adjacent code. Don't improve things you noticed. Only what the feature requires.
5. **No unnecessary abstractions**: Don't add classes, factories, or patterns unless the existing code already uses them for similar things.

### File creation rules:

New files are only appropriate for genuinely new concepts: a new tool, a new API endpoint, a new channel adapter. Specifically:
- NEVER create a file that duplicates an existing module
- NEVER copy an existing file to a new location
- When creating a new file, follow the naming convention of adjacent files

### Export rules:

- NEVER delete existing exports from any file
- When adding new public functionality to a module, add the export to the module's entry point file alongside existing exports
- When adding new exports, use `edit` to insert them — don't rewrite the file

### Import conventions:

- Use `@/` path aliases: `import { getDb } from "@/memory/db/core.js"`
- Always include `.js` extension
- Import from module entry points when available

### Working in the workspace:

All file paths in the workspace are relative to the workspace root (the path returned by `github_clone`). When running commands, use `cd <workspace_path> && <command>`.

## Phase 4: Validate

### 4a. Write tests for new functionality

If your changes add new behavior (new functions, new code paths, new edge cases), write tests for them. Look at existing test files adjacent to the code you changed for patterns:
- Test file naming: `<module>.test.ts` next to `<module>.ts`
- Mock patterns: check how existing tests mock dependencies
- Cover the happy path AND edge cases your feature handles

### 4b. Run all validation in the workspace

```bash
cd <workspace_path> && pnpm install && pnpm run lint && pnpm run tsc && pnpm run test
```

### If lint fails:
- Read the error output
- Fix the specific issues
- Re-run lint

### If tsc fails:
- Read the type errors
- Common causes: missing imports, wrong types, accidentally deleted exports
- Re-run tsc

### If tests fail:
- Read the failing test to understand what it expects
- Fix your code, or update the test if your change intentionally alters behavior
- Re-run tests

Do NOT proceed to Phase 5 until all three pass.

## Phase 5: Submit

### 5a. Review your changes

Before creating the PR, review what you've actually changed:
```bash
cd <workspace_path> && git diff --stat
```

Check for:
- Unexpected files in the diff (files you didn't intend to change)
- Suspiciously large diffs (sign of accidental file replacement)
- New files that shouldn't exist (duplicates of existing files)

If anything looks wrong, investigate and fix.

### 5b. Commit and push

Use `github_commit` with a descriptive message, then `github_push`.

### 5c. Create the PR

Use `github_pr` with a structured body:

```
Title: [Fern] <concise description>

Body:
## What changed
- <bullet point for each logical change>

## Why
<1-2 sentences explaining the motivation>

## Files modified
- `path/to/file.ts` — <what changed>

## How to test
<steps to verify the change works>
```

### 5d. One PR per feature

Create ONE pull request. Don't split unless:
- The changes are genuinely independent
- The PR would be unreviewably large (50+ files)

## Anti-Patterns

### Don't: Delegate implementation to a subagent

YOU are the implementer. Subagents are for parallel research and exploration, not for writing the code. A subagent:
- Has no memory of your conversation or plan
- Doesn't know which files you've already read
- Will likely duplicate files or break exports
- Has limited steps and will produce partial work

Use `explore` subagents to search the codebase. Use `research` subagents for web lookups. Do the coding yourself.

### Don't: Create tasks before reading code

Tasks based on assumptions are wrong tasks. Tasks based on code reading are correct tasks. Always:
1. Read the code
2. THEN create tasks that reference what you found

### Don't: Create duplicate files

If a file exists for the functionality, edit that file. Don't create a parallel version. If you're unsure whether a file exists, search for it first.

### Don't: Delete existing exports

Other modules depend on existing exports. Only ADD new exports alongside what's already there. Never rewrite a file's export list.

### Don't: Assume functionality exists without verifying

If you think the codebase already handles something, read the file and find the specific code. If you can't find it, it doesn't exist.

### Don't: Fire exploration and tasks simultaneously

Exploration results inform the task list. If you start both at once, your tasks will be based on guesses, not facts. Sequence: explore → wait → plan.

### Don't: Skip researching external APIs

When the feature integrates with an external service you haven't used before, research how that API actually works before writing code against it.

## Quick Reference: Codebase Structure

| Layer | Location | Contains |
|-------|----------|----------|
| Entry point | `src/index.ts` | Server startup, initialization |
| Agent loop | `src/core/agent.ts` | Message → OpenCode → response |
| Prompt | `src/core/prompt.ts`, `config/SYSTEM_PROMPT.md` | System prompt assembly |
| Sessions | `src/core/opencode/session.ts` | OpenCode session management |
| HTTP routes | `src/server/server.ts` | Route mounting, middleware |
| Internal APIs | `src/server/*-api.ts` | Tool-facing HTTP endpoints |
| Channel types | `src/channels/types.ts` | Interfaces for all channels |
| WhatsApp | `src/channels/whatsapp/` | Adapter + Twilio gateway |
| Tools | `src/.opencode/tool/` | Agent-callable tools |
| Skills | `src/.opencode/skill/` | On-demand instruction sets |
| Memory | `src/memory/` | SQLite, archival, search |
| Scheduler | `src/scheduler/` | Cron jobs, polling loop |
| Tasks | `src/tasks/` | In-session task tracking |
| Subagents | `src/subagent/` | Background agent spawning |
| Config | `src/config/` | Environment, credentials |
| GitHub | `src/core/github/` | App auth, PR operations |
| Workspace | `src/core/workspace.ts` | Isolated clone management |
