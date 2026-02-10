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

**Session Manager**: Owns session lifecycle (create, load, compact, archive). Sessions are JSONL files. Each channel+user combination maps to a session. Handles channel queue (one active run per session, others wait).

**Tool Executor**: Runs tools with parallel/sequential classification. Maintains tool result cache. Enforces unified permission model.

**Provider Manager**: Handles LLM calls with auth profile rotation and model fallback chain. Tracks costs. Manages retries with exponential backoff.

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

## Layer 3: Tool Execution with Parallelism

```
┌─────────────────────────────────────────────────────────────┐
│                   TOOL EXECUTOR                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tool Call Classifier                    │   │
│  │                                                      │   │
│  │   READ TOOLS          │    WRITE TOOLS              │   │
│  │   (parallelizable)    │    (sequential)             │   │
│  │   ─────────────────   │    ────────────             │   │
│  │   • read              │    • write                  │   │
│  │   • glob              │    • edit                   │   │
│  │   • grep              │    • bash (mutating)        │   │
│  │   • web_fetch         │    • message (send)         │   │
│  │   • memory_search     │    • memory_write           │   │
│  │   • bash (read-only)  │    • github_* (mutations)   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Execution Strategy                      │   │
│  │                                                      │   │
│  │   1. Batch all READ tools from current step         │   │
│  │   2. Execute READs in parallel (Promise.all)        │   │
│  │   3. Execute WRITEs sequentially in order           │   │
│  │   4. Return all results to LLM                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tool Result Cache                       │   │
│  │                                                      │   │
│  │   Key: hash(tool_name + args)                       │   │
│  │   TTL: Per-tool (read: 30s, web_fetch: 5min, etc.) │   │
│  │   Invalidation: On related write tool execution     │   │
│  │                                                      │   │
│  │   read("foo.ts") cached → edit("foo.ts") invalidates│   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Classification**: Simple read/write distinction. No complex dependency graphs. Reads are side-effect-free and parallelizable. Writes are ordered.

**Cache Strategy**: LRU cache keyed by tool+args hash. Write tools invalidate relevant read cache entries.

---

## Layer 4: Channel Adapters (Headless I/O)

```
┌─────────────────────────────────────────────────────────────┐
│                   CHANNEL LAYER                             │
│                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐ │
│  │ Telegram  │  │ WhatsApp  │  │  WebChat  │  │ Webhook │ │
│  │  Adapter  │  │  Adapter  │  │  Adapter  │  │ Adapter │ │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬────┘ │
│        │              │              │              │       │
│        └──────────────┴──────────────┴──────────────┘       │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Unified Channel Interface               │   │
│  │                                                      │   │
│  │   receive(channel, user, message) → sessionKey      │   │
│  │   send(channel, user, content, options)             │   │
│  │   getCapabilities(channel) → { markdown, streaming }│   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Channel Queue                           │   │
│  │                                                      │   │
│  │   Per-session queue (one run at a time)             │   │
│  │   Messages arriving during run → queued             │   │
│  │   On completion → process next in queue             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Output Formatter                        │   │
│  │                                                      │   │
│  │   Telegram: Markdown + chunking (4096 char limit)   │   │
│  │   WhatsApp: Plain text + chunking                   │   │
│  │   WebChat:  Full markdown + streaming               │   │
│  │   Webhook:  JSON payload (for integrations)         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Adapters**: Each channel has an adapter that handles authentication, polling/webhooks, and protocol translation. Adapters are stateless—all state lives in core.

**Unified Interface**: All adapters implement the same interface. Core doesn't know about Telegram vs WhatsApp—it just receives messages and sends responses.

**Channel Context**: The channel name and a "channel prompt" get injected into system context (e.g., `Channel: telegram | Tone: casual, concise`). The agent naturally adapts without the core abstraction changing.

**Streaming Decision**: Based on `getCapabilities()`. WebChat gets real-time streaming. Messaging apps get block delivery.

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

## Layer 6: Observability & UI

```
┌─────────────────────────────────────────────────────────────┐
│               OBSERVABILITY LAYER                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Session Store (Source of Truth)         │   │
│  │                                                      │   │
│  │   sessions/                                         │   │
│  │   ├── {channel}_{user}/                             │   │
│  │   │   ├── session.jsonl    (conversation)           │   │
│  │   │   ├── metadata.json    (stats, costs, etc.)     │   │
│  │   │   └── tools.jsonl      (tool execution log)     │   │
│  │   └── ...                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Observability UI                        │   │
│  │                                                      │   │
│  │   Views:                                            │   │
│  │   • Session List: All sessions, filterable          │   │
│  │   • Session Detail: Full conversation replay        │   │
│  │   • Tool Log: All tool executions with timing       │   │
│  │   • Cost Dashboard: Token/cost breakdown            │   │
│  │   • Error Log: Failed operations, retries           │   │
│  │   • Memory Browser: Persistent memory contents      │   │
│  │                                                      │   │
│  │   Search:                                           │   │
│  │   • By session (channel, user, date range)          │   │
│  │   • Within session (message content, tool names)    │   │
│  │   • Across sessions (full-text search)              │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              No Separate Logging Needed              │   │
│  │                                                      │   │
│  │   JSONL IS the log. UI reads directly from:         │   │
│  │   • session.jsonl → conversation replay             │   │
│  │   • tools.jsonl → tool execution timeline           │   │
│  │   • metadata.json → session stats                   │   │
│  │                                                      │   │
│  │   Structured by design, not by logging layer.       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key Insight**: The JSONL session files ARE the observability data. No need for a separate logging system. The UI is just a viewer/searcher over the existing data.

---

## Layer 7: Unified Permission Model

```
┌─────────────────────────────────────────────────────────────┐
│               PERMISSION SYSTEM                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Permission Resolution                   │   │
│  │                                                      │   │
│  │   1. Base Profile (coding | messaging | minimal)    │   │
│  │              ↓                                       │   │
│  │   2. Channel Restrictions (telegram: no bash)       │   │
│  │              ↓                                       │   │
│  │   3. Path Overrides (*.env → deny, /tmp/* → allow)  │   │
│  │              ↓                                       │   │
│  │   Final: allow | deny                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Permission as Config                    │   │
│  │                                                      │   │
│  │   Allowlist in repo-level config determines tools.  │   │
│  │   If tool isn't allowed, it's not in LLM schema     │   │
│  │   (agent can't call what it doesn't know exists).   │   │
│  │                                                      │   │
│  │   Agent can propose allowlist changes via PR.       │   │
│  │   Human-in-the-loop at PR review, not mid-convo.    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Self-Repo Special Rules                 │   │
│  │                                                      │   │
│  │   When operating on SELF_REPO:                      │   │
│  │   • write/edit → allowed (on branch only)           │   │
│  │   • github_merge → DENIED (always)                  │   │
│  │   • github_pr → allowed (human must approve)        │   │
│  │   • bash with deploy commands → DENIED              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

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
| Session storage | JSONL files | Human-readable, append-only, IS the log |
| Memory (archival) | Async observer + JSON chunks + SQLite + embeddings | Captures history before compaction, two-phase retrieval |
| Memory (persistent) | SQLite + sqlite-vec + OpenAI embeddings | Agent-writable, vector-searchable facts/preferences/learnings |
| Parallelism | Read/write classification | Simple, no graph complexity |
| Caching | LRU with write-invalidation | Easy wins, no stale data |
| Channels | Adapter pattern | Add channels without core changes |
| Self-improvement | PR-only, no direct merge | Safety boundary, human in loop |
| Scheduling | Prompt-based jobs + SQLite + setInterval | Agent autonomy, no external deps, survives restarts |
| Observability | UI over JSONL | No extra logging, data already structured |
| Streaming | Capability-based | Stream where useful, block where not |
| Permissions | Profile + path + channel layers | Flexible without complexity |

---

## Technology Stack

- **Runtime**: Node.js 22+ (TypeScript)
- **LLM SDK**: OpenCode SDK (embedded server + client)
- **Database**: SQLite via better-sqlite3 (memory, scheduling)
- **Vector Store**: sqlite-vec (vector similarity search)
- **Embeddings**: OpenAI text-embedding-3-small
- **Schema Validation**: Zod
- **HTTP Server**: Hono (webhooks, API, internal endpoints)
- **Scheduling**: cron-parser v5, p-queue
- **Channels**: Twilio (WhatsApp), custom WebSocket (WebChat, planned)
