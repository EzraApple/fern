# Fern

A self-improving headless AI agent with multi-channel support (Telegram, WhatsApp, etc.), persistent memory, and the ability to modify its own codebase through controlled PR submissions.

## Current Status

**Phase 1 MVP is complete.** See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for full roadmap.

### What's Working
- Agent loop: message → OpenCode SDK → tool execution → response
- Session storage: OpenCode file-based storage in `~/.local/share/opencode/storage/`
- HTTP API: Hono server on port 4000 (`/health`, `/chat`, `/webhooks/whatsapp`)
- Tools: `echo`, `time` + 6 GitHub tools + 3 memory tools + 3 scheduling tools + `send_message` + built-in coding tools (read, edit, write, bash, glob, grep)
- WhatsApp channel via Twilio (webhook-based)
- Dynamic system prompt from `config/SYSTEM_PROMPT.md` with self-improvement workflow
- OpenCode embedded server (port 4096-4300)
- **Phase 2: Self-improvement loop** - Agent can clone repos, modify code, run tests, create PRs via GitHub App
- **Phase 3: Memory system** - SQLite + sqlite-vec + OpenAI embeddings. Async archival layer captures conversation chunks. Persistent `memory_write` tool for facts/preferences/learnings. Hybrid vector + FTS5 search. Internal HTTP API proxies DB operations for OpenCode tool compatibility.
- **Phase 5: Scheduling** - SQLite job queue in existing memory DB. `schedule` tool creates one-shot or recurring (cron) jobs. Each job is a prompt that fires a fresh agent session — agent has full autonomy to decide what tools to use and what channels to message. `send_message` tool enables proactive outbound messaging to any channel. Background loop polls every 60s.

### Next Up
- Observability (tool execution logging, session metadata)

## Quick Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build TypeScript
pnpm run start        # Start server (needs .env with OPENAI_API_KEY)
pnpm run lint         # Run Biome linter
pnpm run tsc          # Type check
pnpm run memory:wipe  # Wipe all archived memories (dev utility)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, starts Hono server and OpenCode, workspace cleanup |
| `src/core/agent.ts` | Main agent loop using OpenCode SDK |
| `src/core/opencode-service.ts` | OpenCode server/client management, event streaming |
| `src/core/github-service.ts` | GitHub App authentication, PR creation, status checking (Octokit) |
| `src/core/workspace.ts` | Workspace lifecycle (create, cleanup, stale detection) |
| `src/core/workspace-git.ts` | Git operations in workspace (branch, commit, push) |
| `src/types/workspace.ts` | Workspace and git commit type definitions |
| `src/.opencode/tool/` | Tool definitions (OpenCode auto-discovery) |
| `src/.opencode/tool/github-*.ts` | 6 GitHub tools for self-improvement workflow |
| `src/.opencode/tool/memory-write.ts` | Save persistent memories (facts, preferences, learnings) via HTTP |
| `src/.opencode/tool/memory-search.ts` | Hybrid vector + FTS5 search across archives and persistent memories via HTTP |
| `src/.opencode/tool/memory-read.ts` | Read full messages from an archived chunk via HTTP |
| `src/memory/db.ts` | SQLite database (better-sqlite3 + sqlite-vec), schema, CRUD, JSONL migration |
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
| `src/server/server.ts` | HTTP routes (includes internal memory, scheduler, and channel APIs) |
| `src/server/memory-api.ts` | Internal memory API endpoints (write, search, read, delete) |
| `src/server/scheduler-api.ts` | Internal scheduler API endpoints (create, list, get, cancel) |
| `src/server/channel-api.ts` | Internal channel send API (adapter lookup + dispatch) |
| `src/server/webhooks.ts` | Twilio WhatsApp webhook route |
| `src/config/config.ts` | Config loading (includes GitHub App credentials) |
| `src/core/prompt.ts` | System prompt loading, tool injection, channel prompts |
| `config/SYSTEM_PROMPT.md` | Agent personality, self-improvement workflow, safety rules |
| `src/channels/whatsapp/adapter.ts` | WhatsApp adapter (Twilio) |
| `src/channels/whatsapp/twilio-gateway.ts` | Twilio API wrapper |
| `src/channels/format.ts` | Markdown stripping, message chunking |
| `src/channels/types.ts` | Shared channel interfaces |

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
- Base prompt in `config/SYSTEM_PROMPT.md` with `{{TOOLS}}` and `{{CHANNEL_CONTEXT}}` placeholders
- Tool descriptions auto-generated from registry at runtime (never hardcoded)
- Channel-specific prompts injected based on `channelName` in `AgentInput`
- Prompt loaded once and cached via `loadBasePrompt()`

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

### Scheduling System (Phase 5)
- **Storage**: SQLite `scheduled_jobs` table in existing `~/.fern/memory/fern.db` (shared with memory system)
- **Job model**: Each job stores a self-contained prompt. When fired, a fresh agent session runs with that prompt — agent has full autonomy to decide what tools to use and what channels to message.
- **Types**: `one_shot` (single execution) and `recurring` (cron-based). Statuses: `pending → running → completed|failed|cancelled`
- **Scheduler loop**: Background `setInterval` polls every 60s (configurable via `FERN_SCHEDULER_POLL_INTERVAL_MS`). PQueue limits concurrency (default: 3). First tick runs immediately on startup to catch overdue jobs.
- **Cron**: `cron-parser` v5 (`CronExpressionParser.parse()`) for recurring jobs. After each execution, next cron time computed and job reset to `pending`.
- **HTTP proxy pattern**: Same as memory — OpenCode tools call internal API (`/internal/scheduler/*`) via `fetch()` because OpenCode's sandboxed runtime can't load native modules.
- **send_message tool**: Enables proactive outbound messaging to any channel from any session. Calls `/internal/channel/send` which looks up adapter from registry.
- **Config via env vars**: `FERN_SCHEDULER_ENABLED`, `FERN_SCHEDULER_POLL_INTERVAL_MS`, `FERN_SCHEDULER_MAX_CONCURRENT`

## Reference Projects

These were used for inspiration (in `/Users/ezraapple/Projects/`):
- **opencode**: Agent loop pattern, tool interface, config structure
- **openclaw**: Provider abstraction, event-driven architecture

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design with diagrams.

**Key layers:**
- **Core Runtime**: OpenCode SDK manages agent loop, sessions, and tool execution
- **OpenCode Service**: Embedded server, client management, event streaming
- **Tools**: Auto-discovered from `.opencode/tool/` directory
- **Channel Adapters**: WhatsApp (Twilio), WebChat (planned)
- **Self-Improvement**: PR-only code modifications with human approval (Phase 2)

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
| [implementing-tools](agent-docs/implementing-tools.md) | Adding new tools, read/write classification, caching, permissions |
| [implementing-channels](agent-docs/implementing-channels.md) | Adding channel adapters, formatting output, channel prompts |
| [memory-system](agent-docs/memory-system.md) | Working with session/persistent memory, search, compaction |
| [session-management](agent-docs/session-management.md) | JSONL format, context window, channel queues |
| [self-improvement](agent-docs/self-improvement.md) | PR-based self-modification, safety boundaries |

## Project Structure

```
fern/
├── src/
│   ├── index.ts        # Entry point
│   ├── core/           # Agent loop
│   ├── config/         # Configuration
│   ├── storage/        # JSONL sessions
│   ├── tools/          # Tool definitions
│   ├── server/         # HTTP server
│   ├── channels/       # Channel adapters (WhatsApp via Twilio)
│   ├── memory/         # Async archival layer (observer, storage, search, summarizer)
│   └── scheduler/      # Job scheduling (types, config, db, loop)
├── config/             # Config files
├── agent-docs/         # AI development guidance
├── ARCHITECTURE.md     # System design
└── IMPLEMENTATION_PLAN.md  # Roadmap with checklist
```

## Keeping Docs in Sync

When making changes to the project, update all files that describe the affected functionality. The following files overlap in content and must stay consistent:

- **CLAUDE.md** (this file) — Current status, key files, patterns, project structure
- **README.md** — Current functionality, quick start, project structure, planned features
- **ARCHITECTURE.md** — System design, layer descriptions
- **IMPLEMENTATION_PLAN.md** — Phase checklists, roadmap

After any significant change, check whether these need updating:
- New/removed/renamed files → Key Files table, Project Structure tree (both here and README)
- New tools or endpoints → Current Status section (both here and README)
- Phase completion or new phase work → Current Status here, Current Functionality in README, checklist in IMPLEMENTATION_PLAN
- New patterns or conventions → Patterns Established section here
- New agent-docs → Agent Docs table here

## Known Issues / Gotchas

- `exactOptionalPropertyTypes` disabled in tsconfig due to AI SDK type conflicts
- Tool calls handled internally by AI SDK's `maxSteps` - we don't see intermediate tool calls in response
- Node 20 works despite package.json saying 22+ (just a warning)
- Twilio WhatsApp has a 1600-char per-message limit (not WhatsApp's native 65536). Messages are auto-chunked.
- Twilio webhooks require a public URL. Use ngrok for local dev: `ngrok http 4000`
- Twilio SDK works with ESM via default import: `import twilio from "twilio"`
