# Subagent System Implementation Plan

## Context

Fern currently has no way to run background AI tasks or delegate work to specialized agents. The main agent handles everything sequentially — if it needs to explore the codebase, research docs, and plan an implementation, it does all three in its main context window, burning tokens and time.

This adds a subagent system modeled after Claude Code's Task tool: the main agent calls `spawn_task`, gets a task ID back immediately, optionally does other work, then calls `check_task` (which blocks until the result is ready). Three specialized agent types (explore, research, plan) run in separate OpenCode sessions with scoped tool access.

The architecture follows Fern's existing scheduler pattern — SQLite task registry, HTTP proxy tools, internal Hono API, PQueue concurrency control, and `runAgentLoop()` for background execution. The key addition beyond the scheduler pattern is a **completion callback system** (mirroring `sessionCompletionCallbacks` in `session.ts`) that enables `check_task` to block until a task finishes rather than just polling.

## Background: How Claude Code Does It

Claude Code has two background primitives:

1. **Background shell processes** — OS subprocesses (servers, builds, watchers). No AI. Managed via `run_in_background` flag on Bash tool.
2. **Subagents** — Separate LLM conversations with scoped tool access. Launched via `Task` tool with an agent type (Explore, Research, Plan, etc.).

Both share a management interface (`TaskOutput` to check/wait, `TaskStop` to cancel) but are fundamentally different under the hood.

Key behavioral detail: `TaskOutput(block=true)` is the **default** — when the parent agent checks on a subagent, it blocks until the result is ready. This is the dominant pattern: spawn → do other work → block on result when ready. Polling (block=false) is the exception.

The parent agent experiences subagents as **tool calls with non-deterministic, autonomous execution inside**. It writes a prompt, picks a specialist type, and gets back a summary. The subagent makes its own decisions about what tools to call and how many turns to take.

## What OpenCode Already Provides

OpenCode SDK v1.1.53 has surprisingly rich agent support:

| Capability | SDK Support | Notes |
|---|---|---|
| Named agents | `agent: { explore: { mode: "subagent", ... } }` in config | Full agent definitions with mode, prompt, tools, permissions |
| Tool scoping per agent | `tools: { edit: false, write: false }` + `permission: { edit: "deny" }` | Both tool availability and permission rules |
| Agent selection at prompt time | `session.prompt({ agent: "explore" })` | Pass agent name to route to specific agent |
| Fire-and-forget prompting | `session.promptAsync()` | Returns immediately, no SSE subscription needed |
| Parent-child sessions | `session.create({ parentID })` | Session hierarchy tracking |
| Session abort | `session.abort({ sessionID })` | Cancel running sessions |
| Child session listing | `session.children({ sessionID })` | List children of a parent |
| Subtask message parts | `SubtaskPartInput: { type: "subtask", prompt, agent }` | Native inline delegation |
| Built-in agent types | `plan`, `build`, `general`, `explore` | Can be overridden with custom configs |

**What OpenCode does NOT have**: Background task lifecycle management — spawn tracking, status polling, completion callbacks, result storage, blocking wait-for-result.

## Architecture

### Spawning Flow

```
Agent calls spawn_task tool
  → Tool POSTs to /internal/subagent/spawn
    → Creates task record in SQLite (status: pending)
    → Calls enqueueTask() which:
      → Atomically claims task (pending → running)
      → Adds executeTask() to PQueue
    → Returns task ID immediately

executeTask() runs in background:
  → Calls runAgentLoop({
      sessionId: "subagent_${task.id}",
      message: task.prompt,
      channelName: "subagent",
      agent: task.type  // "explore", "research", or "plan"
    })
  → On success: updateTaskStatus("completed", { result }) → signalTaskComplete(taskId)
  → On failure: updateTaskStatus("failed", { error }) → signalTaskComplete(taskId)
```

### Result Retrieval Flow (Blocking)

```
Agent calls check_task(taskId, wait=true)
  → Tool GETs /internal/subagent/get/:id?wait=true&timeout=300000
    → Task already terminal? Return immediately with result
    → Task still running? Call waitForTask(taskId, timeout) which:
      → Registers callback in taskCompletionCallbacks map
      → Returns promise that resolves when signalTaskComplete fires
      → Or rejects on timeout
    → Return task with result/error
```

This mirrors the `sessionCompletionCallbacks` pattern already used in `src/core/opencode/session.ts` for detecting when `prompt()` completes.

### Result Retrieval Flow (Polling)

```
Agent calls check_task(taskId, wait=false)
  → Tool GETs /internal/subagent/get/:id
    → Returns current task state immediately
    → If running: "Task task_123 is still running (45s elapsed)"
    → If completed: full result text
```

## New Files

```
src/subagent/
├── types.ts        # SubagentTask, SubagentType, TaskStatus, SubagentConfig
├── config.ts       # Config with env vars: FERN_SUBAGENT_ENABLED, _MAX_CONCURRENT, _TIMEOUT_MS
├── db.ts           # SQLite CRUD (mirrors scheduler/db.ts)
├── executor.ts     # PQueue + background execution + completion callbacks
└── index.ts        # Barrel: initSubagent(), stopSubagent()

src/server/
└── subagent-api.ts # Internal API: /spawn, /get/:id (with ?wait=true), /list, /cancel/:id

src/.opencode/tool/
├── spawn-task.ts   # spawn_task tool
├── check-task.ts   # check_task tool (supports blocking wait)
└── cancel-task.ts  # cancel_task tool
```

## Modified Files

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `agent?: string` to `AgentInput` |
| `src/core/agent.ts` | Pass `input.agent ?? "fern"` instead of hardcoded `"fern"` (1 line) |
| `src/core/opencode/config.ts` | Add explore, research, plan agent definitions with tool scoping |
| `src/core/prompt.ts` | Add "subagent" channel prompt to `CHANNEL_PROMPTS` |
| `src/server/server.ts` | Mount subagent API at `/internal/subagent` (2 lines) |
| `src/index.ts` | Call `initSubagent()` on startup, `stopSubagent()` on cleanup |
| `config/SYSTEM_PROMPT.md` | Add subagent routing to the "what to reach for" section |
| `CLAUDE.md` | Update tool count (16→19), add key files, add subagent pattern section |

## Implementation Steps

### Step 1: Types and Config

**`src/subagent/types.ts`** — Core types mirroring `src/scheduler/types.ts`:

```typescript
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type SubagentType = "explore" | "research" | "plan";

export interface SubagentTask {
  id: string;
  type: SubagentType;
  status: TaskStatus;
  prompt: string;
  description: string;
  parentSessionId: string;
  childSessionId?: string;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export interface CreateTaskInput {
  type: SubagentType;
  prompt: string;
  description: string;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentConfig {
  enabled: boolean;
  maxConcurrent: number;
  taskTimeoutMs: number;
}
```

**`src/subagent/config.ts`** — Follow exact `src/scheduler/config.ts` pattern. Env vars: `FERN_SUBAGENT_ENABLED` (default true), `FERN_SUBAGENT_MAX_CONCURRENT` (default 3), `FERN_SUBAGENT_TIMEOUT_MS` (default 480000).

### Step 2: Database Layer

**`src/subagent/db.ts`** — Mirror `src/scheduler/db.ts`. Table `subagent_tasks`:

```sql
CREATE TABLE IF NOT EXISTS subagent_tasks (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  prompt            TEXT NOT NULL,
  description       TEXT NOT NULL,
  parent_session_id TEXT NOT NULL,
  child_session_id  TEXT,
  result            TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON subagent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON subagent_tasks(parent_session_id);
```

Functions: `createSubagentSchema()`, `insertTask()`, `getTaskById()`, `updateTaskStatus()`, `claimTask()` (atomic pending→running), `listTasks()` (filter by status/parentSessionId), `cancelTask()`, `recoverStaleTasks()` (marks running→failed — not pending like scheduler, because stale subagent tasks are not retriable), `generateTaskId()` (`task_${ulid()}`).

Row type and `rowToTask()` mapper follow same pattern as `scheduler/db.ts`.

### Step 3: Agent Definitions in OpenCode Config

Add to `getOpenCodeConfig()` in `src/core/opencode/config.ts`, inside the `agent` object alongside `fern`:

- **explore**: `mode: "subagent"`, tools: `{ read: true, grep: true, glob: true, bash: true, edit: false, write: false }`, permission: `{ bash: "allow", edit: "deny", external_directory: "allow" }`, `maxSteps: 30`. System prompt focuses on finding files, understanding code structure, reporting findings concisely.

- **research**: `mode: "subagent"`, same read-only tools + `webfetch: "allow"` in permission, `maxSteps: 40`. System prompt focuses on web search, documentation reading, synthesizing findings.

- **plan**: `mode: "subagent"`, same read-only tools, `maxSteps: 50`. System prompt focuses on analyzing requirements, exploring code patterns, producing step-by-step implementation plans with specific file paths.

All subagents are read-only (`edit: false`, `write: false`, `edit: "deny"`). Overrides OpenCode's built-in `explore`/`plan` agents with our custom definitions.

### Step 4: Agent Parameter in runAgentLoop

Add `agent?: string` to `AgentInput` in `src/core/types.ts`.

In `src/core/agent.ts` line 45, change `agent: "fern"` to `agent: input.agent ?? "fern"`. This is the only line change — `prompt()` in `session.ts` already accepts and passes through `options.agent`.

### Step 5: Execution Engine with Completion Callbacks

**`src/subagent/executor.ts`** — Combines the PQueue pattern from `src/scheduler/loop.ts` with a completion callback pattern from `src/core/opencode/session.ts`.

Key components:

**Completion callback map** (mirrors `sessionCompletionCallbacks` in session.ts):
```typescript
const taskCompletionCallbacks = new Map<string, {
  resolve: (task: SubagentTask) => void;
  reject: (err: Error) => void;
}>();
```

**`waitForTask(taskId, timeoutMs)`** — Returns a promise that resolves when the task completes or rejects on timeout. If the task is already terminal (completed/failed/cancelled), resolves immediately with the current state. Otherwise registers a callback and waits.

**`signalTaskComplete(taskId)`** — Called by `executeTask` after updating SQLite. Reads the updated task from DB and resolves the waiting promise if one exists.

**`executeTask(task)`** — Calls `runAgentLoop({ sessionId: "subagent_${task.id}", message: task.prompt, channelName: "subagent", agent: task.type })`. On completion: updates SQLite with result → calls `signalTaskComplete()`. On failure: updates SQLite with error → calls `signalTaskComplete()` (the waiter gets the failed task).

**`enqueueTask(task)`** — Atomic claim + add to PQueue. Returns immediately.

**`initExecutor()`** / **`stopExecutor()`** — PQueue lifecycle + stale task recovery.

### Step 6: Internal API with Blocking Get

**`src/server/subagent-api.ts`** — Mirrors `src/server/scheduler-api.ts` with one key addition: the `/get/:id` endpoint supports `?wait=true&timeout=300000` query params.

Endpoints:

- **`POST /internal/subagent/spawn`** — Zod-validated, creates task + calls `enqueueTask()`, returns task metadata immediately.

- **`GET /internal/subagent/get/:id`** — Two modes:
  - Default (no `wait` param): returns current task state immediately (poll mode)
  - `?wait=true&timeout=300000`: calls `waitForTask(id, timeout)` which blocks until the task reaches a terminal state or times out. Default timeout: 300s (5 min).

- **`POST /internal/subagent/list`** — Filter by status/parentSessionId, ordered by created_at DESC.

- **`POST /internal/subagent/cancel/:id`** — Marks as cancelled if pending/running.

### Step 7: Wiring

- **`src/subagent/index.ts`** — Barrel export: `initSubagent()` (creates schema + inits executor), `stopSubagent()`.

- **`src/server/server.ts`** — Add import + `app.route("/internal/subagent", createSubagentApi())` after line 84 (scheduler mount). Already covered by `/internal/*` auth middleware.

- **`src/index.ts`** — Add `initSubagent()` after line 172 (scheduler init). Add `stopSubagent()` in the cleanup handler before `stopScheduler()`.

- **`src/core/prompt.ts`** — Add to `CHANNEL_PROMPTS`:
  ```
  subagent: ## Channel: Subagent
  - You are a background subagent executing a specific task for the main Fern agent.
  - Focus exclusively on the task described in the prompt. Be thorough but concise.
  - Your response will be read by the parent agent, not a human — optimize for information density.
  - Do NOT use send_message, schedule, or any communication tools.
  - Do NOT modify files. You are read-only.
  - Structure your response: brief summary first, then detailed findings.
  ```

### Step 8: OpenCode Tools (with Prompting)

These tool descriptions are critical — they teach the agent **when** to use subagents, **how** to write good prompts, and **what workflow** to follow.

**`src/.opencode/tool/spawn-task.ts`** (`spawn_task`):

Tool description:
```
Spawn a background subagent to handle a task while you continue working. Returns a task ID
immediately. Use check_task with wait=true to block until the result is ready, or wait=false
to poll.

WHEN TO USE:
- Need to explore or search the codebase → type: "explore"
- Need to look up external docs, APIs, or best practices → type: "research"
- Need to break down a complex task into implementation steps → type: "plan"

WHEN NOT TO USE:
- Simple one-off questions (just use your own tools directly)
- Tasks that need to modify files (subagents are read-only)
- Tasks where you already know the answer

WRITING GOOD PROMPTS:
The subagent runs in a SEPARATE session with NO memory of this conversation. The prompt must
be completely self-contained:
- BAD: "Find the file we were just discussing"
- GOOD: "Find all files in src/memory/ that handle vector search. Read each one and explain
  how the hybrid search scoring works."
- BAD: "How does the auth work?"
- GOOD: "Read src/server/internal-auth.ts and src/server/webhooks.ts. Explain the
  authentication middleware pattern: what header is checked, how secrets are validated, and
  what happens in dev mode when no secret is configured."

Include specific file paths, function names, and context when you have them. More context =
better results.

WORKFLOW:
1. Spawn one or more tasks
2. Continue doing other work (or spawn more tasks)
3. Call check_task(id, wait=true) when you need the result — this blocks until done
4. Use the result to inform your response

You can spawn multiple tasks in parallel for independent questions.
```

Args: `type` (enum: explore/research/plan), `prompt` (string — self-contained), `description` (string — short label), optional `metadata`.

**`src/.opencode/tool/check-task.ts`** (`check_task`):

Tool description:
```
Check on or wait for a spawned subagent task. Two modes:

- wait=true (DEFAULT, RECOMMENDED): Blocks until the task completes and returns the full
  result. Use this when you're ready for the result. This is the normal workflow — spawn a
  task, do other work, then block on the result when you need it.

- wait=false: Returns immediately with current status. Use this only if you want to check
  whether a task is done without waiting (e.g., to decide whether to do more work while it
  runs).

If the task completed, returns the full result text. If it failed, returns the error. If
cancelled, tells you it was cancelled.
```

Args: `taskId` (string), `wait` (boolean, optional, default true), `timeoutMs` (number, optional, default 300000 — 5 min).

The `wait` default is `true` because that's the primary usage pattern — the agent calls check_task when it's ready to consume the result and should block. This mirrors Claude Code's `TaskOutput(block=true)` default.

**`src/.opencode/tool/cancel-task.ts`** (`cancel_task`):

Tool description:
```
Cancel a pending or running subagent task. Use check_task first to verify the task is still
active. Pending tasks cancel immediately. Running tasks are marked cancelled but the
underlying session may take a moment to stop.
```

Args: `taskId` (string).

### Step 9: System Prompt Update

Add to the "What to reach for based on intent" section in `config/SYSTEM_PROMPT.md`, after the scheduling entry:

```markdown
- Need to explore code, research docs, or plan an implementation? → `spawn_task` to delegate, `check_task` to get results, `cancel_task` to abort
- Multiple independent questions to investigate? → spawn multiple tasks in parallel, then check each result
```

### Step 10: Documentation Updates

Update `CLAUDE.md`:
- Tool count: 16 → 19 (add `spawn_task`, `check_task`, `cancel_task`)
- Key Files table: add `src/subagent/` files
- Patterns Established: add Subagent System section
- Project Structure: add `src/subagent/` directory
- Env vars: add `FERN_SUBAGENT_ENABLED`, `FERN_SUBAGENT_MAX_CONCURRENT`, `FERN_SUBAGENT_TIMEOUT_MS`

### Step 11: Tests

**`src/subagent/db.test.ts`** — Mirror `src/scheduler/db.test.ts`:
- Schema creation (idempotent)
- insertTask / getTaskById round-trip
- claimTask atomicity (only from pending, returns false if already claimed)
- updateTaskStatus with result/error fields
- listTasks with filters (status, parentSessionId, limit)
- cancelTask from pending, from running, cannot cancel completed
- recoverStaleTasks marks running → failed
- generateTaskId prefix and uniqueness

**`src/subagent/executor.test.ts`** — Mock `runAgentLoop`:
- executeTask calls runAgentLoop with correct args (agent type as agent param, "subagent" as channelName)
- executeTask updates status to completed with result on success
- executeTask updates status to failed with error on failure
- waitForTask resolves immediately if task already terminal
- waitForTask blocks and resolves when signalTaskComplete called
- waitForTask rejects on timeout

## Key Architecture Decisions

**Why `runAgentLoop` in background instead of `promptAsync()`**: `runAgentLoop` already handles session creation, SSE event subscription, timeout, response extraction, and memory archival. Using `promptAsync()` would require reimplementing all of that. The background void-async pattern is already proven in the WhatsApp webhook handler (`src/server/webhooks.ts`).

**Why completion callbacks instead of polling**: The agent should be able to block on `check_task(wait=true)` the same way Claude Code blocks on `TaskOutput(block=true)`. This requires server-side waiting, not client-side polling. The callback map pattern is already proven in `session.ts` (`sessionCompletionCallbacks`). The HTTP endpoint holds the response open until the callback fires or timeout expires.

**Why `wait=true` is the default for check_task**: This mirrors Claude Code's `TaskOutput` which blocks by default. The dominant usage pattern is: spawn task → do other work → "give me the result now, I'll wait." Polling (wait=false) is the exception, not the norm.

**Why override OpenCode's built-in agents**: OpenCode has built-in `explore` and `plan` agents, but we want custom system prompts, tool restrictions, and step limits tuned for Fern's use case.

**Why `recoverStaleTasks` marks as failed (not pending)**: Unlike scheduled jobs, subagent tasks are one-shot and conversation-dependent. Re-running a stale task after a crash makes no sense — the parent conversation has moved on.

**Why no watchdog integration**: Subagent failures are isolated background tasks. The main agent checks task status and handles failures gracefully. Unlike scheduler failures (systemic), a single subagent failing is normal operation.

## Future Enhancements

- **Cross-turn result injection**: When a subagent completes after the parent's turn ended, auto-inject results into the next turn's system prompt. Requires checking for completed-but-unchecked tasks at the start of each `runAgentLoop` call.
- **True cancellation via `session.abort()`**: Currently cancellation only marks SQLite status. Could call `session.abort({ sessionID })` on the OpenCode client for immediate termination. Requires storing the OpenCode sessionId (not just threadId) in the task record — the `child_session_id` field exists for this.
- **Background shell processes**: Separate from subagents — a `run_background` tool for long-running OS processes (dev servers, builds, watchers). Would use `child_process.spawn` with an in-memory PID registry. Independent system, could share the `check_task`/`cancel_task` UI pattern.
- **Custom agent types**: Allow defining new agent types via config or even at runtime, beyond the initial explore/research/plan.
- **Dashboard integration**: Add subagent task view to the observability dashboard (task status, duration, token cost).

## Verification

1. `pnpm run tsc` — type check passes
2. `pnpm run lint` — Biome lint passes
3. `pnpm run test` — all tests pass including new db + executor tests
4. Manual test: start Fern, send a message like "I need to understand how the memory search system works — explore the codebase and explain it to me"
   - Agent should call `spawn_task(type: "explore", prompt: "Read files in src/memory/... explain hybrid search...")`
   - Get back task ID immediately
   - Call `check_task(taskId, wait: true)` which blocks until explore agent finishes
   - Use the result to respond to the user
5. Parallel test: ask something requiring multiple explorations — agent should spawn multiple tasks, then check each
