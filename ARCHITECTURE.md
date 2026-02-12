# Fern Architecture

## Core Design Principle

**Headless Core + Channel Adapters + Self-Improvement Loop**

The system is a long-running Node process that accepts work from any channel, executes via an agent loop, and can modify its own codebase through controlled PR submission.

---

## Layer 1: The Core Runtime

```
┌─────────────────────────────────────────────────────────────┐
│                      CORE RUNTIME                           │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Session   │  │    Tool     │  │      Provider       │ │
│  │   Manager   │  │   Executor  │  │      Manager        │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│         │                │                    │             │
│         ▼                ▼                    ▼             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Agent Loop                         │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────┐  │   │
│  │  │ Receive │→ │ Execute  │→ │ Stream  │→ │ Store │  │   │
│  │  │ Message │  │ + Tools  │  │ Result  │  │ State │  │   │
│  │  └─────────┘  └──────────┘  └─────────┘  └───────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐              │
│         ▼                 ▼                 ▼              │
│  ┌───────────┐     ┌───────────┐     ┌───────────┐        │
│  │  Memory   │     │   Cache   │     │ Observ-   │        │
│  │  System   │     │   Layer   │     │ ability   │        │
│  └───────────┘     └───────────┘     └───────────┘        │
└─────────────────────────────────────────────────────────────┘
```

**Session Manager**: Maps channel+user combinations to OpenCode thread IDs. Manages session lifecycle with 1-hour TTL for reuse. Sessions stored in OpenCode's file-based storage.

**Tool Executor**: OpenCode handles tool execution internally. 14 custom tools auto-discovered from `src/.opencode/tool/`. Tools needing native modules use HTTP proxy to Fern server.

**Provider Manager**: LLM calls handled via OpenCode SDK. Model configured in `config/config.json5` (default: gpt-4o-mini).

**Agent Loop**: The core iteration cycle. Receives message → calls LLM → executes tools → streams result → stores state. Loops until no more tool calls or termination condition.

---

## Layer 2: Memory System

```
┌─────────────────────────────────────────────────────────────┐
│                     MEMORY SYSTEM                           │
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────────┐    │
│  │  Archival Memory    │    │  Persistent Memory      │    │
│  │  (Async Shadow)     │    │  (Agent-Written)        │    │
│  │  ✅ IMPLEMENTED     │    │  ✅ IMPLEMENTED         │    │
│  └─────────────────────┘    └─────────────────────────┘    │
│           │                            │                    │
│           │  SQLite + sqlite-vec       │  SQLite DB         │
│           │  {summary, messages,       │  facts, prefs,     │
│           │   embeddings} per chunk    │  learnings + embeds │
│           │                            │                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Archival Observer (async, non-blocking)    │   │
│  │                                                      │   │
│  │  agent turn completes                               │   │
│  │       → fetch all messages from OpenCode            │   │
│  │       → check watermark (how far we've archived)    │   │
│  │       → if unarchived > 25k tokens: chunk + summarize│  │
│  │       → store {summary, original messages}          │   │
│  │       → advance watermark                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                        │                                    │
│                        ▼                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Hybrid Search (Vector + FTS5)             │   │
│  │           SQLite + sqlite-vec + FTS5                │   │
│  │           Vector similarity (0.7) + keyword (0.3)   │   │
│  │           Internal HTTP API for OpenCode tools      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Archival Memory**: An async shadow layer that observes OpenCode sessions. After each agent turn, it captures conversation chunks (~25k tokens each), summarizes them via gpt-4o-mini, and stores {summary, original_messages} pairs. This runs independently of OpenCode's own context compaction — our threshold is well below OpenCode's, so chunks are captured before messages are lost.

**Persistent Memory**: Agent-writable knowledge base via `memory_write` tool. Stored in SQLite with embeddings for semantic search. Categories: facts, preferences, learnings.

**Two-Phase Retrieval**:
- `memory_search(query)` → returns `[{chunkId, threadId, summary, relevance, tokenCount, timeRange}]`
- `memory_read(chunkId, threadId)` → returns full original messages from that chunk

This gives the agent "perfect recall" — search summaries for relevant history, then read exact messages when needed.

---

## Layer 3: Tool System

```
┌─────────────────────────────────────────────────────────────┐
│                   TOOL SYSTEM                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              OpenCode Auto-Discovery                 │   │
│  │                                                      │   │
│  │   Tools defined in src/.opencode/tool/ using         │   │
│  │   OpenCode plugin format: tool({ ... })              │   │
│  │   Auto-discovered at startup (no registry needed)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tool Categories                         │   │
│  │                                                      │   │
│  │   BASIC          │  GITHUB         │  MEMORY         │   │
│  │   • echo         │  • github_clone │  • memory_write │   │
│  │   • time         │  • github_branch│  • memory_search│   │
│  │                   │  • github_commit│  • memory_read  │   │
│  │   SCHEDULING     │  • github_push  │                 │   │
│  │   • schedule     │  • github_pr    │  MESSAGING      │   │
│  │   • schedule_list│  • github_pr_   │  • send_message │   │
│  │   • schedule_    │    status       │                 │   │
│  │     cancel       │                 │                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              HTTP Proxy Pattern                      │   │
│  │                                                      │   │
│  │   OpenCode tools run in sandboxed JS runtime that    │   │
│  │   can't load native modules (better-sqlite3, etc.)   │   │
│  │   Tools use fetch() to call internal HTTP APIs:      │   │
│  │   • /internal/memory/*    (memory operations)        │   │
│  │   • /internal/scheduler/* (scheduling operations)    │   │
│  │   • /internal/channel/*   (message sending)          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Auto-Discovery**: Tools are defined in `src/.opencode/tool/` and automatically loaded by OpenCode at startup. No manual registry needed.

**HTTP Proxy**: Tools that need native modules (SQLite, etc.) use `fetch()` to call internal Fern server endpoints instead of importing directly.

**Skills**: On-demand Markdown instruction files in `src/.opencode/skill/`. The built-in `skill` tool surfaces skill names and descriptions, and the LLM loads them when a task matches. Current skills: `adding-skills`, `adding-mcps`, `adding-tools` (bootstrapping skills), `web-research` (Tavily + web_fetch best practices), `self-update`, `verify-update`.

**MCP Servers**: External tool servers configured in `src/.opencode/opencode.jsonc`. Currently: Fetch MCP (`@modelcontextprotocol/server-fetch`) for free general-purpose URL fetching, Tavily MCP (`tavily-mcp`) for AI-optimized web search, extraction, mapping, and crawling. MCPs are auto-discovered at startup and their tools become available alongside native tools.

---

## Layer 4: Channel Adapters (Headless I/O)

```
┌─────────────────────────────────────────────────────────────┐
│                   CHANNEL LAYER                             │
│                                                             │
│  ┌───────────┐                                              │
│  │ WhatsApp  │  (additional adapters can be added)          │
│  │  Adapter  │                                              │
│  │  (Twilio) │                                              │
│  └─────┬─────┘                                              │
│        │                                                     │
│        ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Unified Channel Interface               │   │
│  │                                                      │   │
│  │   ChannelAdapter interface (src/channels/types.ts)  │   │
│  │   send(message) → deliver to channel                │   │
│  │   getCapabilities() → { markdown, streaming, ... }  │   │
│  │   deriveSessionId(identifier) → session key         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Output Formatter                        │   │
│  │                                                      │   │
│  │   WhatsApp: Plain text + chunking (1600 char limit) │   │
│  │   Markdown stripping via src/channels/format.ts     │   │
│  │   Auto-chunking at natural break points             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Adapters**: Each channel has an adapter that handles authentication, webhooks, and protocol translation. Adapters are stateless—all state lives in core.

**Unified Interface**: Adapters implement the `ChannelAdapter` interface. Core doesn't know about WhatsApp specifics—it just receives messages and sends responses.

**Channel Context**: Channel-specific prompts are defined in `src/core/prompt.ts` (`CHANNEL_PROMPTS` record) and injected into the system prompt via the `{{CHANNEL_CONTEXT}}` placeholder at runtime. Current channels: `whatsapp`, `webchat`, `scheduler`. The agent naturally adapts without the core abstraction changing.

**Current Implementation**: WhatsApp via Twilio (webhook-based). Additional adapters can be added by implementing the `ChannelAdapter` interface.

---

## Layer 5: Self-Improvement System

```
┌─────────────────────────────────────────────────────────────┐
│               SELF-IMPROVEMENT SYSTEM                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Coding Sub-Agent                        │   │
│  │                                                      │   │
│  │   • Spawned for code modification tasks             │   │
│  │   • Works in cloned repo (isolated workspace)       │   │
│  │   • Has full coding tools (read, edit, write, bash) │   │
│  │   • Creates branch, makes changes, commits          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              GitHub Integration                      │   │
│  │                                                      │   │
│  │   Tools:                                            │   │
│  │   • github_clone(repo) → workspace                  │   │
│  │   • github_branch(name) → creates branch            │   │
│  │   • github_commit(message) → commits changes        │   │
│  │   • github_pr(title, body) → opens PR               │   │
│  │   • github_pr_status(pr) → check CI/approval        │   │
│  │                                                      │   │
│  │   Self-repo detection:                              │   │
│  │   • If repo == SELF_REPO → PR required (no merge)   │   │
│  │   • CI must pass + human approval before merge      │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Improvement Loop                        │   │
│  │                                                      │   │
│  │   Trigger: User request OR scheduled self-review    │   │
│  │                                                      │   │
│  │   1. Analyze: Review logs, errors, user feedback    │   │
│  │   2. Plan: Identify improvement opportunity         │   │
│  │   3. Implement: Coding sub-agent makes changes      │   │
│  │   4. Test: Run test suite in workspace              │   │
│  │   5. Submit: Open PR with description               │   │
│  │   6. Wait: Human reviews and approves               │   │
│  │   7. Learn: Store outcome in persistent memory      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Safety Boundary**: The agent can never directly modify its running code. All self-modifications go through PRs that require human approval.

**Workspace Isolation**: Coding sub-agent works in a cloned repo, not the live deployment. Changes are proposed, not applied.

**Improvement Sources**:
- Explicit user requests ("add feature X")
- Error analysis ("I keep failing at Y, let me fix that")
- Performance observations ("tool Z is slow, let me optimize")
- Scheduled self-review (weekly: "what could I do better?")

---

## Layer 6: Observability & Dashboard (✅ IMPLEMENTED)

```
┌─────────────────────────────────────────────────────────────┐
│               OBSERVABILITY LAYER                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Dashboard API (src/server/dashboard-api)│   │
│  │                                                      │   │
│  │   GET  /api/sessions             → list sessions    │   │
│  │   GET  /api/sessions/:id         → session detail   │   │
│  │   GET  /api/sessions/:id/messages→ session messages │   │
│  │   GET  /api/memories             → persistent mems  │   │
│  │   POST /api/memories/search      → hybrid search    │   │
│  │   GET  /api/archives             → archive summaries│   │
│  │   GET  /api/archives/:t/:c       → full chunk       │   │
│  │   GET  /api/github/prs           → PR listing       │   │
│  │   GET  /api/github/prs/:number   → PR status/checks │   │
│  │   GET  /api/tools                → available tools  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Dashboard App (apps/dashboard/)        │   │
│  │              Next.js 15 + React 19 + SWR            │   │
│  │                                                      │   │
│  │   Views:                                            │   │
│  │   • Overview: Summary cards (sessions, mems, PRs)   │   │
│  │   • Sessions: Browse with message history replay    │   │
│  │   • Memory: Persistent mems, archives, search       │   │
│  │   • Tools: Execution analytics + detail modals      │   │
│  │   • GitHub: PR list with checks/reviews             │   │
│  │   • Costs: Token usage + cost breakdown             │   │
│  │                                                      │   │
│  │   Proxies /api/* → Fern backend via Next.js rewrites│   │
│  │   Dark theme, Tailwind CSS 4, Lucide icons          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Dashboard API**: Public REST endpoints on the Fern server expose session, memory, archive, GitHub, and tool data. No separate logging system needed — the API reads directly from OpenCode storage, SQLite memory DB, and GitHub.

**Dashboard App**: A separate Next.js 15 app in `apps/dashboard/` (pnpm monorepo workspace). Proxies API requests to the Fern backend. Uses SWR for client-side data fetching with auto-refresh.

---

## Layer 8: Scheduling System (✅ IMPLEMENTED)

```
┌─────────────────────────────────────────────────────────────┐
│               SCHEDULING SYSTEM                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Schedule Tool                           │    │
│  │                                                      │    │
│  │   schedule(prompt, scheduledAt|delayMs|cronExpr)     │    │
│  │   schedule_list(status?, limit?)                     │    │
│  │   schedule_cancel(jobId)                             │    │
│  │                                                      │    │
│  │   Calls /internal/scheduler/* via fetch()            │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              SQLite Job Queue                        │    │
│  │              (scheduled_jobs table in fern.db)       │    │
│  │                                                      │    │
│  │   Jobs: id, type, status, prompt, scheduled_at,     │    │
│  │         cron_expr, metadata, last_run_response      │    │
│  │                                                      │    │
│  │   Types: one_shot | recurring                        │    │
│  │   Status: pending → running → completed|failed       │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Scheduler Loop                          │    │
│  │                                                      │    │
│  │   setInterval (60s) → query due jobs                 │    │
│  │   PQueue (concurrency: 3) → executeJob()             │    │
│  │   executeJob: runAgentLoop(fresh session, job.prompt) │    │
│  │   Recurring: cron-parser → compute next → reset      │    │
│  │   First tick on startup catches overdue jobs          │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              send_message Tool                       │    │
│  │                                                      │    │
│  │   Proactive outbound messaging to any channel        │    │
│  │   Calls /internal/channel/send → adapter.send()      │    │
│  │   Enables scheduled jobs to reach users              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Prompt-Based Jobs**: Each job stores a self-contained prompt. When fired, a fresh agent session runs with that prompt and full tool access. The agent decides what to do — send messages, create PRs, search memory, etc.

**No Retry Logic**: Jobs either complete or fail. The agent or user can reschedule if needed.

**Use Cases**: Reminders ("message me at 9am"), follow-ups ("check PR #42 in 2 hours"), recurring tasks ("weekly self-review" via cron)

---

## System Flow: End-to-End Example

```
User sends "help me optimize the memory search function" via Telegram
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. RECEIVE                                                  │
│    Telegram Adapter receives message                        │
│    → Maps to session: telegram_user123                      │
│    → Checks queue: empty, proceed                           │
│    → Loads session from JSONL                               │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CONTEXT                                                  │
│    Memory search: "memory search optimization"              │
│    → Finds relevant past discussions                        │
│    → Injects as context                                     │
│    Session history: last N turns from JSONL                 │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. AGENT LOOP                                               │
│    LLM decides: "I need to spawn coding sub-agent"          │
│    → Tool: spawn_coding_agent(task: "optimize memory...")   │
│    → Sub-agent clones self-repo, creates branch             │
│    → Sub-agent reads code (parallel: 3 files at once)       │
│    → Sub-agent edits (sequential: one at a time)            │
│    → Sub-agent runs tests                                   │
│    → Sub-agent opens PR                                     │
│    → Returns PR URL to parent                               │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. RESPOND                                                  │
│    Format for Telegram (markdown, chunked if long)          │
│    "I've analyzed the memory search function and opened     │
│     PR #42 with optimizations: [link]                       │
│     Changes: - Added LRU cache for embeddings               │
│              - Reduced chunk overlap from 80 to 40 tokens   │
│     Please review when you have time."                      │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. STORE                                                    │
│    Append to session.jsonl                                  │
│    Append to tools.jsonl (tool executions)                  │
│    Update metadata.json (token count, cost)                 │
│    Write to persistent memory: "Optimized memory search,    │
│      PR #42, key insight: embedding cache helps"            │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core runtime | Single Node process | Simplicity, no distributed state |
| Session storage | OpenCode file-based | Managed by OpenCode SDK, tracks diffs/parts/messages |
| Tool system | OpenCode auto-discovery | Tools in `.opencode/tool/` auto-loaded, no registry |
| Tool I/O | HTTP proxy pattern | OpenCode's sandboxed runtime can't load native modules |
| Skills | On-demand Markdown files | Agent loads knowledge when needed, not always in context |
| MCP | Fetch + Tavily MCPs via opencode.jsonc | Free URL fetching + AI-optimized web search, extraction, crawling |
| Memory (archival) | Async observer + JSON chunks + SQLite + embeddings | Captures history before compaction, two-phase retrieval |
| Memory (persistent) | SQLite + sqlite-vec + OpenAI embeddings | Agent-writable, vector-searchable facts/preferences/learnings |
| Channels | Adapter pattern | Add channels without core changes |
| Self-improvement | PR-only, no direct merge | Safety boundary, human in loop |
| Scheduling | Prompt-based jobs + SQLite + setInterval | Agent autonomy, no external deps, survives restarts |
| Observability | Dashboard API + Next.js app | API reads from existing data stores, no separate logging |
| Monorepo | pnpm workspaces | Root (agent) + apps/dashboard |

---

## Technology Stack

- **Runtime**: Node.js 22+ (TypeScript, ESM)
- **LLM SDK**: OpenCode SDK (embedded server + client)
- **Database**: SQLite via better-sqlite3 (memory, scheduling)
- **Vector Store**: sqlite-vec (vector similarity search)
- **Embeddings**: OpenAI text-embedding-3-small
- **Schema Validation**: Zod
- **HTTP Server**: Hono (webhooks, API, internal endpoints)
- **Scheduling**: cron-parser v5, p-queue
- **Channels**: Twilio (WhatsApp)
- **Dashboard**: Next.js 15, React 19, SWR, Tailwind CSS 4
- **Testing**: Vitest (26 test files, feature-based CI)
- **Linting**: Biome
- **Monorepo**: pnpm workspaces
