# Fern

A self-improving headless AI agent with WhatsApp support, persistent memory, observability dashboard, and the ability to modify its own codebase through controlled PR submissions.

## Current Status

**All core phases complete** (MVP, Self-Improvement, Memory, Observability, Scheduling).

### What's Working
- Agent loop: message → OpenCode SDK → tool execution → response
- Session storage: OpenCode file-based storage in `~/.local/share/opencode/storage/`
- HTTP API: Hono server on port 4000 (`/health`, `/chat`, `/webhooks/whatsapp`, `/webhooks/github`, `/api/*` dashboard endpoints)
- Tools: 20 tools — `echo`, `time` + 6 GitHub tools + 3 memory tools + 3 scheduling tools + 4 task tools + `send_message` + `trigger_update` + `trigger_rollback` + built-in coding tools (read, edit, write, bash, glob, grep)
- WhatsApp channel via Twilio (webhook-based)
- Dynamic system prompt from `config/SYSTEM_PROMPT.md` with self-improvement workflow
- OpenCode embedded server (port 4096-4300)
- **Phase 2: Self-improvement loop** - Agent can clone repos, modify code, run tests, create PRs via GitHub App
- **Phase 3: Memory system** - SQLite + sqlite-vec + OpenAI embeddings. Async archival layer captures conversation chunks. Persistent `memory_write` tool for facts/preferences/learnings. Hybrid vector + FTS5 search. Internal HTTP API proxies DB operations for OpenCode tool compatibility.
- **Phase 4: Observability** - Next.js 15 dashboard app (`apps/dashboard/`) with views for sessions, memory, tools, GitHub PRs, and costs. Dashboard API at `/api/*` on the Fern server.
- **Phase 5: Scheduling** - SQLite job queue in existing memory DB. `schedule` tool creates one-shot or recurring (cron) jobs. Each job is a prompt that fires a fresh agent session — agent has full autonomy to decide what tools to use and what channels to message. `send_message` tool enables proactive outbound messaging to any channel. Background loop polls every 60s.
- **Hardening**: Internal API auth (shared-secret middleware), Twilio webhook signature verification, watchdog with WhatsApp failure alerts, pm2 process supervision.
- **Skills**: 6 skills (`adding-skills`, `adding-mcps`, `adding-tools`, `self-update`, `verify-update`, `web-research`) loaded on-demand via OpenCode's `skill` tool. Auto-accepted (no confirmation prompt) for unattended operation.
- **Auto-Update**: GitHub webhook detects pushes to main → agent reviews changes, notifies user, triggers update → updater script (separate pm2 process) pulls/builds/restarts → agent resumes same session for verification → rollback if broken. Thread-session map persisted in SQLite for session continuity across restarts.
- **Task Tracking**: In-session task/todo system. 4 tools (`task_create`, `task_update`, `task_list`, `task_next`) for breaking complex work into tracked steps. Thread-scoped, flat ordered list, 7-day cleanup for done/cancelled tasks.
- **MCP**: Fetch MCP (`@modelcontextprotocol/server-fetch`) for web content retrieval + Tavily MCP (`tavily-mcp`) for AI-optimized web search, extraction, mapping, and crawling. Configured in `src/.opencode/opencode.jsonc`.

## Quick Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build TypeScript
pnpm run start        # Start server (needs .env with OPENAI_API_KEY)
pnpm run lint         # Run Biome linter
pnpm run tsc          # Type check
pnpm run test         # Run all tests (Vitest)
pnpm run start:prod   # Build + start with pm2 (auto-restart, logging)
pnpm run stop:prod    # Stop pm2 process
pnpm run logs         # Tail pm2 logs
pnpm run recent       # Show last 10 turns from most recent session (quick debugging)
pnpm run memory:wipe  # Wipe all archived memories (dev utility)
pnpm run dashboard    # Start dashboard dev server (port 3000)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, starts Hono server and OpenCode, workspace cleanup |
| `src/core/agent.ts` | Main agent loop using OpenCode SDK |
| `src/core/opencode/config.ts` | OpenCode client type, port constants, `getOpenCodeConfig()` |
| `src/core/opencode/server.ts` | OpenCode server lifecycle: `ensureOpenCode()`, `getClient()`, `cleanup()` |
| `src/core/opencode/session.ts` | Session management: `getOrCreateSession()`, `prompt()`, `AgentTimeoutError` |
| `src/core/opencode/queries.ts` | Event streaming, message queries: `subscribeToEvents()`, `getSessionMessages()` |
| `src/core/github/types.ts` | `PRInfo`, `PRStatus`, `CheckStatus`, `Review`, `CreatePRParams` interfaces |
| `src/core/github/auth.ts` | GitHub App authentication, `getOctokit()`, `getAuthenticatedCloneUrl()` |
| `src/core/github/pr.ts` | PR operations: `createPullRequest()`, `getPRStatus()`, `listPRs()` |
| `src/core/deploy-state.ts` | Deploy state JSON file read/write for auto-update lifecycle |
| `src/core/workspace.ts` | Workspace lifecycle (create, cleanup, stale detection) |
| `src/core/workspace-git.ts` | Git operations in workspace (branch, commit, push) |
| `src/types/workspace.ts` | Workspace and git commit type definitions |
| `src/.opencode/opencode.jsonc` | OpenCode config (MCP servers, permissions) |
| `src/.opencode/tool/` | Tool definitions (OpenCode auto-discovery) |
| `src/.opencode/skill/` | Skills (on-demand instruction sets for the agent) |
| `src/.opencode/tool/github-*.ts` | 6 GitHub tools for self-improvement workflow |
| `src/.opencode/tool/memory-write.ts` | Save persistent memories (facts, preferences, learnings) via HTTP |
| `src/.opencode/tool/memory-search.ts` | Hybrid vector + FTS5 search across archives and persistent memories via HTTP |
| `src/.opencode/tool/memory-read.ts` | Read full messages from an archived chunk via HTTP |
| `src/memory/db/core.ts` | SQLite database lifecycle: `initMemoryDb()`, `getDb()`, `closeDb()`, schema creation |
| `src/memory/db/summaries.ts` | Summary CRUD: `insertSummary()`, `listSummaries()` |
| `src/memory/db/memories.ts` | Persistent memory CRUD: `insertMemory()`, `deleteMemory()`, `getMemoryById()`, `listMemories()` |
| `src/memory/db/thread-sessions.ts` | Thread-session map: `saveThreadSession()`, `getThreadSession()` |
| `src/memory/db/migration.ts` | JSONL → SQLite migration logic |
| `src/memory/embeddings.ts` | OpenAI text-embedding-3-small wrapper (embedText, embedBatch) |
| `src/memory/persistent.ts` | Persistent memory CRUD (writeMemory, deleteMemory, getMemory, listMemories) |
| `src/memory/search.ts` | Hybrid vector + FTS5 search across summaries and persistent memories |
| `src/memory/observer.ts` | Core archival logic: chunk detection, summarization, embedding, storage |
| `src/memory/storage.ts` | File I/O for chunks and watermarks |
| `src/memory/summarizer.ts` | LLM summarization of chunks via gpt-4o-mini |
| `src/memory/tokenizer.ts` | Token estimation from OpenCode messages |
| `src/memory/config.ts` | Memory configuration (DB path, embedding model, thresholds) |
| `src/memory/types.ts` | ArchiveChunk, PersistentMemory, UnifiedSearchResult, etc. |
| `src/scheduler/types.ts` | ScheduledJob, CreateJobInput, SchedulerConfig, JobStatus, JobType |
| `src/scheduler/config.ts` | Scheduler config with env var overrides (enabled, poll interval, concurrency) |
| `src/scheduler/db.ts` | Scheduler DB schema + CRUD on `scheduled_jobs` table in memory DB |
| `src/scheduler/loop.ts` | Background setInterval, PQueue concurrency, job execution via runAgentLoop |
| `src/scheduler/index.ts` | Public exports: initScheduler, stopScheduler |
| `src/.opencode/tool/schedule.ts` | `schedule` tool — create one-shot or recurring jobs |
| `src/.opencode/tool/schedule-manage.ts` | `schedule_list` and `schedule_cancel` tools |
| `src/.opencode/tool/send-message.ts` | `send_message` tool — proactive outbound messaging to any channel |
| `src/.opencode/tool/trigger-update.ts` | `trigger_update` tool — writes flag file to trigger updater script |
| `src/.opencode/tool/trigger-rollback.ts` | `trigger_rollback` tool — writes flag file to trigger rollback |
| `src/.opencode/tool/task-create.ts` | `task_create` tool — create a task for multi-step work |
| `src/.opencode/tool/task-update.ts` | `task_update` tool — update task status/details |
| `src/.opencode/tool/task-list.ts` | `task_list` tool — list all tasks for a session |
| `src/.opencode/tool/task-next.ts` | `task_next` tool — get the next task to work on |
| `src/tasks/types.ts` | Task, TaskStatus, CreateTaskInput type definitions |
| `src/tasks/db.ts` | Tasks DB schema + CRUD on `tasks` table in memory DB |
| `src/tasks/index.ts` | Public exports: initTasks, all DB functions and types |
| `src/server/tasks-api.ts` | Internal tasks API endpoints (create, list, update, next) |
| `src/.opencode/skill/self-update/` | Pre-update skill — review changes, notify user, trigger deploy |
| `src/.opencode/skill/verify-update/` | Post-update skill — health checks, rollback, fix PR guidance |
| `src/server/server.ts` | HTTP routes (includes internal memory, scheduler, tasks, channel, and dashboard APIs) |
| `src/server/dashboard-api.ts` | Public dashboard API endpoints (sessions, memories, archives, GitHub PRs, tools) |
| `src/server/memory-api.ts` | Internal memory API endpoints (write, search, read, delete) |
| `src/server/scheduler-api.ts` | Internal scheduler API endpoints (create, list, get, cancel) |
| `src/server/channel-api.ts` | Internal channel send API (adapter lookup + dispatch) |
| `src/server/github-webhook.ts` | GitHub push webhook route (with HMAC signature verification) |
| `src/server/webhooks.ts` | Twilio WhatsApp webhook route (with signature verification) |
| `src/server/internal-auth.ts` | Shared-secret auth middleware for `/internal/*` routes |
| `src/core/alerts.ts` | WhatsApp failure alert sender with retry logic |
| `src/core/watchdog.ts` | Consecutive failure tracking + shutdown trigger |
| `ecosystem.config.cjs` | pm2 process management config (fern, fern-updater, caffeinate, ngrok) |
| `scripts/updater.sh` | Auto-update script — polls for trigger files, does git pull + build + restart or rollback |
| `src/config/config.ts` | Config loading (includes GitHub App credentials) |
| `src/core/prompt.ts` | System prompt loading, tool injection, channel prompts |
| `config/SYSTEM_PROMPT.md` | Agent personality, self-improvement workflow, safety rules |
| `src/channels/whatsapp/adapter.ts` | WhatsApp adapter (Twilio) |
| `src/channels/whatsapp/twilio-gateway.ts` | Twilio API wrapper |
| `src/channels/format.ts` | Markdown stripping, message chunking |
| `src/channels/types.ts` | Shared channel interfaces |
| `apps/dashboard/` | Next.js 15 observability dashboard (monorepo workspace) |
| `apps/dashboard/src/lib/api.ts` | Fetch wrappers for all dashboard API endpoints |
| `apps/dashboard/src/lib/hooks.ts` | SWR hooks (useSessions, useMemories, useArchives, usePRs, useTools) |
| `apps/dashboard/src/lib/types.ts` | TypeScript types mirroring OpenCode SDK models |

## Patterns Established

### Tool Definition
Tools are defined in `src/.opencode/tool/` using OpenCode plugin format:
```typescript
import { tool } from "@opencode-ai/plugin";

export const echo = tool({
  description: "...",
  args: {
    text: tool.schema.string().describe("..."),
  },
  async execute(args) {
    return args.text;
  },
});
```

Tools are auto-discovered by OpenCode at startup (no registry needed).

Tool descriptions contain detailed usage prompting — when to use, common mistakes, behavioral notes. This keeps the system prompt light (intent routing only) while tool-specific guidance lives with the tools.

### Skills
Skills are on-demand Markdown instruction files in `src/.opencode/skill/<name>/SKILL.md`. The built-in `skill` tool lists available skills (name + description) in its own description. The LLM loads skills when a task matches a skill's description.

Key points:
- YAML frontmatter with `name` (must match directory) and `description` (the trigger — only thing LLM sees before loading)
- Auto-accepted (`"permission": { "skill": "allow" }` in `opencode.jsonc`) for unattended operation
- Current skills: `adding-skills`, `adding-mcps`, `adding-tools`, `web-research`

### MCP Servers
MCP (Model Context Protocol) servers provide external tools, configured in `src/.opencode/opencode.jsonc`:
- **Local MCPs**: Run as child processes (stdio transport). Config: `{ "type": "local", "command": [...] }`
- **Remote MCPs**: Connect to HTTP endpoints. Config: `{ "type": "remote", "url": "..." }`
- Tools auto-prefixed with server name: server `"web"` → tool `web_fetch`
- Current MCPs: `web` (`@modelcontextprotocol/server-fetch` — free general-purpose URL fetching), `tv` (`tavily-mcp` — AI-optimized web search, extraction, mapping, and crawling)

### Session Storage
- OpenCode manages sessions in `~/.local/share/opencode/storage/`
- File-based: `project/`, `session/`, `message/`, `part/`, `session_diff/`
- Tracks file diffs, message parts, and git integration
- Thread-based session continuity (maps channel session → OpenCode threadId)
- 1-hour TTL for session reuse

### Agent Loop
- OpenCode SDK handles everything: LLM calls, tool execution, conversation history
- Event streaming for real-time progress (tool_start, tool_complete, session_idle)
- Embedded server on port 4096-4300 (retry logic on conflict)
- Thread-based session mapping for conversation continuity across messages

### System Prompt
- **`src/core/prompt.ts` is the single source of truth** for prompt composition (not `core/opencode/`)
- Base prompt in `config/SYSTEM_PROMPT.md` with `{{TOOLS}}` and `{{CHANNEL_CONTEXT}}` placeholders
- Tool descriptions auto-generated from registry at runtime (never hardcoded)
- Channel-specific prompts defined in `CHANNEL_PROMPTS` record in `prompt.ts` (whatsapp, webchat, scheduler)
- `buildSystemPrompt()` loads base prompt, replaces placeholders, injects channel context
- Prompt loaded once and cached via `loadBasePrompt()`
- Self-improvement detection is pattern-based (intent, not exact phrasing) with context-gated confirmation
- **Prompting strategy**: System prompt handles behavior/personality and intent routing (which tool for which task). Tool-specific guidance (how to use, gotchas, anti-patterns) lives in tool descriptions. Skills provide on-demand knowledge for unfamiliar workflows.

### Channel Adapter
- Adapters implement `ChannelAdapter` interface from `src/channels/types.ts`
- WhatsApp (Twilio) is the reference implementation
- Webhook-based: Twilio POSTs to `/webhooks/whatsapp`, we respond via REST API
- Output formatted per channel capabilities (markdown stripping, chunking)
- Session derived from phone number: `whatsapp_{phone}`

### Workspace Isolation (Phase 2)
- All code modifications happen in isolated temp workspaces, never touching live codebase
- Workspace location: `os.tmpdir()/fern-workspaces/{ulid}/`
- Lifecycle: create → branch → modify → test → commit → push → PR → cleanup
- Git operations confined to workspace via `cwd` option
- Auto-cleanup on process exit and stale workspace detection on startup
- Self-repo URL documented in system prompt (https://github.com/EzraApple/fern)

### Memory System (Phase 3)
- **Storage**: SQLite via `better-sqlite3` + `sqlite-vec` extension for vector search. DB at `~/.fern/memory/fern.db`
- **Embeddings**: OpenAI `text-embedding-3-small` (1536-dim) for semantic search
- **Archival**: Async shadow layer observes sessions, chunks messages into ~25k token segments, summarizes via gpt-4o-mini, embeds, stores in SQLite
- **Persistent memory**: `memory_write` tool lets agent store facts, preferences, learnings with tags
- **Hybrid search**: Vector similarity (0.7 weight) + FTS5 keyword (0.3 weight), merged by ID, across both archives and persistent memories
- **HTTP proxy pattern**: OpenCode tools run in OpenCode's embedded Go binary JS runtime which can't load native modules. Tools use `fetch()` to call internal API endpoints (`/internal/memory/*`) on the fern server, which handles all DB operations.
- **Internal API**: `POST /internal/memory/write`, `POST /internal/memory/search`, `POST /internal/memory/read`, `DELETE /internal/memory/delete/:id`
- Two-phase retrieval: `memory_search` finds relevant summaries → `memory_read` returns full original messages
- Per-thread PQueue (concurrency: 1) prevents concurrent archival on same thread
- Config via env vars: `FERN_MEMORY_ENABLED`, `FERN_MEMORY_PATH`, `FERN_MEMORY_CHUNK_TOKENS`, `FERN_MEMORY_MODEL`, `FERN_MEMORY_EMBEDDING_MODEL`

### GitHub Integration (Phase 2)
- GitHub App authentication via Octokit (`@octokit/app`)
- PRs created by "Fern" GitHub App (not user account)
- 6 tools: `github_clone`, `github_branch`, `github_commit`, `github_push`, `github_pr`, `github_pr_status`
- Branch protection enforced (PR-only merges to main)
- All operations validated and errors surfaced to agent for handling

### Auto-Update System
- **Trigger**: GitHub push webhook (`/webhooks/github`) with HMAC-SHA256 signature verification (optional via `GITHUB_WEBHOOK_SECRET`)
- **Pre-update**: Webhook writes deploy state (`~/.fern/deploy-state.json`), fires agent session with `self-update` skill. Agent reviews incoming commits, notifies user via WhatsApp, calls `trigger_update` tool.
- **Mechanical update**: Separate pm2 process (`fern-updater`) polls for flag files (`~/.fern/update-trigger.flag`). On trigger: backup `dist/` → `git pull` → `pnpm install` → `pnpm build` → `pm2 restart fern`.
- **Post-update**: On startup, detects in-progress deploy state, resumes SAME OpenCode session with `verify-update` skill. Agent runs self-checks, notifies user, rolls back if broken.
- **Rollback**: Agent calls `trigger_rollback` → updater restores `dist-backup/` → restart → agent opens fix PR via normal self-improvement workflow.
- **Session continuity**: Thread-session map persisted in SQLite `thread_sessions` table (survives restarts). Consistent `deploy_session` threadId ensures same conversation across restart boundary.
- **Deploy state**: JSON file tracks status (`in_progress` → `verifying` → `completed` | `rolled_back`), before/after SHAs, commit details, timestamps.

### Scheduling System (Phase 5)
- **Storage**: SQLite `scheduled_jobs` table in existing `~/.fern/memory/fern.db` (shared with memory system)
- **Job model**: Each job stores a self-contained prompt. When fired, a fresh agent session runs with that prompt — agent has full autonomy to decide what tools to use and what channels to message.
- **Types**: `one_shot` (single execution) and `recurring` (cron-based). Statuses: `pending → running → completed|failed|cancelled`
- **Scheduler loop**: Background `setInterval` polls every 60s (configurable via `FERN_SCHEDULER_POLL_INTERVAL_MS`). PQueue limits concurrency (default: 3). First tick runs immediately on startup to catch overdue jobs.
- **Cron**: `cron-parser` v5 (`CronExpressionParser.parse()`) for recurring jobs. After each execution, next cron time computed and job reset to `pending`.
- **HTTP proxy pattern**: Same as memory — OpenCode tools call internal API (`/internal/scheduler/*`) via `fetch()` because OpenCode's sandboxed runtime can't load native modules.
- **send_message tool**: Enables proactive outbound messaging to any channel from any session. Calls `/internal/channel/send` which looks up adapter from registry.
- **Config via env vars**: `FERN_SCHEDULER_ENABLED`, `FERN_SCHEDULER_POLL_INTERVAL_MS`, `FERN_SCHEDULER_MAX_CONCURRENT`

### Task Management
- **Storage**: SQLite `tasks` table in existing `~/.fern/memory/fern.db` (shared with memory and scheduler)
- **Thread-scoped**: Tasks belong to a thread (session ID). Agent passes `threadId` as an explicit arg (same as `memory_search`).
- **Statuses**: `pending → in_progress → done | cancelled`
- **Ordering**: Flat list with `sort_order`. Display order: in_progress first, then pending by sort_order, then done, then cancelled.
- **4 tools**: `task_create`, `task_update`, `task_list`, `task_next` — all return formatted checklist after mutations.
- **HTTP proxy pattern**: Same as memory/scheduler — tools call internal API (`/internal/tasks/*`) via `fetch()`.
- **Cleanup**: 7-day auto-cleanup of done/cancelled tasks on startup.
- **Session ID injection**: `buildSystemPrompt()` injects session ID into channel context so agent can pass it to task tools.

### Observability Dashboard (Phase 4)
- **Dashboard API**: Public REST endpoints at `/api/*` on the Fern server (`src/server/dashboard-api.ts`)
- **Dashboard App**: Next.js 15 app in `apps/dashboard/` (pnpm monorepo workspace, runs on port 3000)
- **Data sources**: Reads from OpenCode storage (sessions/messages), SQLite memory DB (memories/archives), and GitHub API (PRs/status)
- **Proxying**: Next.js rewrites `/api/*` to `http://127.0.0.1:4000/api/*` (configurable via `FERN_API_URL` env var)
- **Client-side**: SWR hooks for data fetching, React 19, Tailwind CSS 4, dark theme
- **Views**: Overview, Sessions, Memory (3 tabs), Tools, GitHub, Costs

### Hardening (Security + Ops)
- **Internal API auth**: Shared-secret middleware (`src/server/internal-auth.ts`) protects `/internal/*` routes. Checks `X-Fern-Secret` header against `FERN_API_SECRET` env var. Passthrough when not configured (dev mode). All 6 OpenCode tools include the header via `getAuthHeaders()`.
- **Twilio webhook verification**: `src/server/webhooks.ts` validates `X-Twilio-Signature` against `FERN_WEBHOOK_URL` env var. Uses `adapter.validateWebhook()` which calls `twilio.validateRequest()`. Skipped when URL not configured (dev mode).
- **Watchdog**: `src/core/watchdog.ts` tracks consecutive failures for OpenCode (file-persisted across pm2 restarts) and scheduler (in-memory). Triggers alert + shutdown when thresholds exceeded. Config via `FERN_WATCHDOG_MAX_OPENCODE_FAILURES` and `FERN_WATCHDOG_MAX_SCHEDULER_FAILURES`.
- **Alerts**: `src/core/alerts.ts` sends WhatsApp messages directly via `TwilioGateway` (not through agent loop) to `FERN_ALERT_PHONE`. Retries 3x with 2s delay.
- **pm2 supervision**: `ecosystem.config.cjs` with auto-restart, max 15 restarts, 5s delay, log files in `logs/`. Scripts: `start:prod`, `stop:prod`, `logs`.

## Reference Projects

These were used for inspiration (in `/Users/ezraapple/Projects/`):
- **opencode**: Agent loop pattern, tool interface, config structure
- **openclaw**: Provider abstraction, event-driven architecture

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design with diagrams.

**Key layers:**
- **Core Runtime**: OpenCode SDK manages agent loop, sessions, and tool execution
- **OpenCode Service**: Embedded server, client management, event streaming
- **Tools**: 18 tools auto-discovered from `.opencode/tool/`, native module access via HTTP proxy
- **Channel Adapters**: WhatsApp (Twilio)
- **Memory**: SQLite + sqlite-vec, async archival, persistent memories, hybrid search
- **Scheduling**: SQLite job queue, cron support, background polling loop
- **Observability**: Dashboard API + Next.js 15 app
- **Self-Improvement**: PR-only code modifications with human approval

## Agent Docs

### General (reusable across projects)

| Doc | Reference When |
|-----|----------------|
| [general-typescript-best-practices](agent-docs/general-typescript-best-practices.md) | Writing type definitions, using discriminated unions, handling null/undefined |
| [general-code-style-best-practices](agent-docs/general-code-style-best-practices.md) | Naming variables/functions, writing comments, choosing patterns |
| [general-json-parsing-best-practices](agent-docs/general-json-parsing-best-practices.md) | Parsing JSON strings, validating unknown data with Zod |
| [general-architecture-patterns](agent-docs/general-architecture-patterns.md) | Building services/gateways, organizing backend code, error handling |
| [general-service-method-naming](agent-docs/general-service-method-naming.md) | Naming service methods (get, find, create, update) |

### Fern-Specific

| Doc | Reference When |
|-----|----------------|
| [implementing-tools](agent-docs/implementing-tools.md) | Adding new tools using OpenCode plugin format, HTTP proxy pattern |
| [implementing-channels](agent-docs/implementing-channels.md) | Adding channel adapters, formatting output, channel prompts |
| [memory-system](agent-docs/memory-system.md) | Working with session/persistent memory, search, compaction |
| [session-management](agent-docs/session-management.md) | OpenCode session management, context window, archival |
| [self-improvement](agent-docs/self-improvement.md) | PR-based self-modification, safety boundaries |

## Project Structure

```
fern/                              # pnpm monorepo
├── src/
│   ├── index.ts                   # Entry point (alerts, watchdog init)
│   ├── core/                      # Agent loop, workspace, alerts, watchdog
│   │   ├── opencode/              # OpenCode server/client, sessions, event streaming
│   │   └── github/                # GitHub App auth, PR operations
│   ├── config/                    # Configuration loading
│   ├── server/                    # HTTP server, dashboard API, internal APIs, auth middleware
│   ├── channels/                  # Channel adapters (WhatsApp via Twilio)
│   ├── memory/                    # Async archival, persistent memory, hybrid search
│   │   └── db/                    # SQLite database (schema, summaries, memories, thread-sessions)
│   ├── scheduler/                 # Job scheduling (types, config, db, loop)
│   ├── tasks/                     # In-session task tracking (types, db, index)
│   └── .opencode/                 # OpenCode configuration
│       ├── opencode.jsonc         # MCP servers, permissions
│       ├── tool/                  # 16 tools (auto-discovered by OpenCode)
│       └── skill/                 # On-demand skills (adding-skills, adding-mcps, adding-tools, self-update, verify-update, web-research)
├── apps/
│   └── dashboard/                 # Next.js 15 observability dashboard
├── config/                        # Config files + system prompt
├── scripts/
│   └── updater.sh                 # Auto-update script (pm2 process)
├── agent-docs/                    # AI development guidance
├── ecosystem.config.cjs           # pm2 process management (fern, fern-updater, caffeinate, ngrok)
└── ARCHITECTURE.md                # System design
```

## Keeping Docs in Sync

When making changes to the project, update all files that describe the affected functionality. The following files overlap in content and must stay consistent:

- **CLAUDE.md** (this file) — Current status, key files, patterns, project structure
- **README.md** — Current functionality, quick start, project structure
- **ARCHITECTURE.md** — System design, layer descriptions

After any significant change, check whether these need updating:
- New/removed/renamed files → Key Files table, Project Structure tree (both here and README)
- New tools or endpoints → Current Status section (both here and README)
- New patterns or conventions → Patterns Established section here
- New agent-docs → Agent Docs table here

## Known Issues / Gotchas

- `exactOptionalPropertyTypes` disabled in tsconfig due to AI SDK type conflicts
- Tool calls handled internally by AI SDK's `maxSteps` - we don't see intermediate tool calls in response
- Node 20 works despite package.json saying 22+ (just a warning)
- Twilio WhatsApp has a 1600-char per-message limit (not WhatsApp's native 65536). Messages are auto-chunked.
- Twilio webhooks require a public URL. Use ngrok for local dev: `ngrok http 4000`
- Twilio SDK works with ESM via default import: `import twilio from "twilio"`
- All imports use `@/` path aliases (e.g., `import { getDb } from "@/memory/db/core.js"`). `tsc-alias` rewrites these to relative paths at build time. Vitest resolves them via the `resolve.alias` config in `vitest.config.ts`.
- Tavily MCP free tier: 1,000 credits/month. `web_fetch` is free and unlimited for simple URL reads. Prefer `web_fetch` when you already have the URL.
