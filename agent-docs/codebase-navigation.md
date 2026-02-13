---
name: Codebase Navigation
description: |
  Practical guide to navigating Fern's codebase when making modifications.
  Reference when: planning code changes, finding the right file to edit, understanding module boundaries.
---

# Codebase Navigation

A practical "where to look" guide for modifying Fern's codebase. Not a reference doc — a map for making changes safely.

## Architecture Overview

Fern has three broad layers:

```
src/
├── core/           # Business logic (agent loop, sessions, prompts, GitHub, workspace)
├── server/         # HTTP layer (routes, API handlers, webhooks, middleware)
├── channels/       # Messaging adapters (WhatsApp, future channels)
├── memory/         # Persistent storage (SQLite, archival, search)
├── scheduler/      # Job queue (cron, background polling)
├── tasks/          # In-session task tracking
├── subagent/       # Background agent spawning
├── config/         # Configuration loading
└── .opencode/      # OpenCode runtime (tools, skills, config)
    ├── tool/       # Agent-callable tools (auto-discovered)
    └── skill/      # On-demand instruction sets
```

**Key rule**: `src/server/` is HTTP. `src/core/` is logic. Don't put business logic in server files. Don't put HTTP routes in core files.

## "I need to change..." Quick Lookup

### Message processing
- **Inbound message handling**: `src/server/webhooks.ts` (WhatsApp webhook route)
- **Agent loop (message → LLM → response)**: `src/core/agent.ts`
- **System prompt composition**: `src/core/prompt.ts` + `config/SYSTEM_PROMPT.md`
- **Session management**: `src/core/opencode/session.ts`

### WhatsApp integration
- **Adapter (send, capabilities, session derivation)**: `src/channels/whatsapp/adapter.ts`
- **Twilio API wrapper**: `src/channels/whatsapp/twilio-gateway.ts`
- **Webhook route**: `src/server/webhooks.ts`
- **Shared channel interfaces**: `src/channels/types.ts`
- **Output formatting (markdown strip, chunking)**: `src/channels/format.ts`

### Adding a new channel
1. Define adapter implementing `ChannelAdapter` from `src/channels/types.ts`
2. Add gateway wrapper for the external service
3. Add webhook route in `src/server/` (or extend `webhooks.ts` if simple)
4. Mount route in `src/server/server.ts`
5. Initialize adapter in `src/index.ts`
6. Add channel prompt in `src/core/prompt.ts` (`CHANNEL_PROMPTS` record)

### Adding a new tool
- **Tool file**: `src/.opencode/tool/toolname.ts` (auto-discovered, no registry)
- **If it needs native modules**: Add internal API in `src/server/newtool-api.ts`, mount in `src/server/server.ts`
- **Pattern reference**: `src/.opencode/tool/memory-write.ts` (HTTP proxy), `src/.opencode/tool/echo.ts` (simple)
- **Skill reference**: Load the `adding-tools` skill

### Adding a new internal API
1. Create handler: `src/server/myfeature-api.ts`
2. Mount in `src/server/server.ts` under `/internal/myfeature/*`
3. Auth is automatic (all `/internal/*` routes go through `internalAuth()` middleware)
4. Pattern reference: `src/server/memory-api.ts`, `src/server/scheduler-api.ts`

### Changing the system prompt
- **Base prompt**: `config/SYSTEM_PROMPT.md` (Markdown with `{{TOOLS}}` and `{{CHANNEL_CONTEXT}}` placeholders)
- **Prompt assembly**: `src/core/prompt.ts` — `buildSystemPrompt()` loads base, replaces placeholders
- **Channel-specific prompts**: `CHANNEL_PROMPTS` record in `src/core/prompt.ts`
- **Tool descriptions**: Auto-generated from tool names at runtime (never hardcoded in prompt)

### Database changes
- **Schema creation**: `src/memory/db/core.ts` (`initMemoryDb()` runs all schema creation)
- **Table-specific CRUD**: `src/memory/db/summaries.ts`, `src/memory/db/memories.ts`, `src/memory/db/thread-sessions.ts`
- **Scheduler table**: `src/scheduler/db.ts`
- **Tasks table**: `src/tasks/db.ts`
- **Subagent table**: `src/subagent/db.ts`
- All tables share one SQLite database at `~/.fern/memory/fern.db`

### Self-improvement / GitHub PRs
- **GitHub App auth**: `src/core/github/auth.ts`
- **PR operations**: `src/core/github/pr.ts`
- **Workspace lifecycle**: `src/core/workspace.ts`
- **Git operations in workspace**: `src/core/workspace-git.ts`
- **GitHub tools**: `src/.opencode/tool/github-*.ts`

## Module Exports

Each module has an entry point file that defines its public API. Other modules import from these. **Never delete existing exports** — only add new ones alongside what's already there.

| Module | Entry point | Key exports |
|--------|------------|-------------|
| `src/server/` | `index.ts` | `createServer`, `ServerOptions` |
| `src/core/` | `index.ts` | `runAgentLoop`, `buildSystemPrompt`, `loadBasePrompt` |
| `src/channels/` | `index.ts` | `ChannelAdapter`, `Attachment`, `WhatsAppAdapter`, formatters |
| `src/memory/` | `index.ts` | `initMemoryDb`, `closeDb`, `onTurnComplete`, `writeMemory`, `searchMemory` |
| `src/scheduler/` | `index.ts` | `initScheduler`, `stopScheduler`, DB functions, types |
| `src/tasks/` | `index.ts` | `initTasks`, DB functions, types |
| `src/subagent/` | `index.ts` | `initSubagent`, `stopSubagent`, executor, DB functions, types |
| `src/config/` | `index.ts` | `loadConfig`, `getTwilioCredentials`, `getApiSecret` |

## File Relationships

```
src/index.ts (entry point)
 ├── src/channels/index.ts    → WhatsAppAdapter
 ├── src/config/index.ts      → loadConfig, getTwilioCredentials
 ├── src/core/agent.ts        → runAgentLoop
 ├── src/core/opencode/server.ts → ensureOpenCode, cleanup
 ├── src/memory/index.ts      → initMemoryDb, closeDb
 ├── src/scheduler/index.ts   → initScheduler, stopScheduler
 ├── src/server/index.ts      → createServer
 ├── src/subagent/index.ts    → initSubagent, stopSubagent
 └── src/tasks/index.ts       → initTasks

src/server/server.ts (HTTP server)
 ├── src/server/*-api.ts      → internal API route creators
 ├── src/server/webhooks.ts   → WhatsApp webhook route
 └── src/server/github-webhook.ts → GitHub push webhook

src/core/agent.ts (agent loop)
 ├── src/core/opencode/queries.ts → event streaming, tool list
 ├── src/core/opencode/session.ts → session management, prompt
 ├── src/core/prompt.ts       → system prompt assembly
 └── src/memory/index.ts      → archival observer
```

## Where NOT to Create New Files

| Don't create | Why | Instead |
|-------------|-----|---------|
| `src/server/agent.ts` | Agent logic belongs in `src/core/` | Edit `src/core/agent.ts` |
| `src/core/webhooks.ts` | HTTP routes belong in `src/server/` | Edit `src/server/webhooks.ts` |
| `src/channels/whatsapp/image-handler.ts` | Don't split adapters into per-feature files | Extend `adapter.ts` or `twilio-gateway.ts` |
| Any `*-utils.ts` or `*-helpers.ts` | Keep functions in the module they serve | Add to the existing module file |
| Copies of existing files | Never duplicate a module | Edit the original |

## Import Conventions

- All imports use `@/` path alias: `import { getDb } from "@/memory/db/core.js"`
- Always include `.js` extension (ESM requirement; `tsc-alias` rewrites to relative paths at build)
- Import from module entry points when available, not internal files
- Do NOT import internal module files from outside the module

## External Dependencies

When modifying code that integrates with external services (Twilio, GitHub API, OpenCode SDK, etc.), research the external API's behavior before writing code. Use `research` subagents or the `web-research` skill to understand:
- What data format the API sends/receives
- Authentication requirements
- Rate limits or size constraints
- Edge cases (missing fields, error responses)

Don't assume how an external API works based on variable names or existing comments — verify it.
