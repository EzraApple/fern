# Fern Implementation Plan

A phased roadmap from MVP to full-featured self-improving agent.

---

## Phase 1: MVP Core

Get a basic working agent that can receive messages and respond.

**Goal:** Prove the core loop works end-to-end before adding channels.

### 1.1 Configuration
- JSON5 config file for model, storage, server settings
- Environment variable support (.env for API keys)
- Default to gpt-4o-mini for cheap testing

### 1.2 Session Storage
- JSONL file per session (~/.fern/sessions/{sessionId}/)
- Append-only event log (messages, tool calls, results)
- Session metadata JSON (created, updated, message count)

### 1.3 Toy Tools
- `echo` - Echo back input text (test tool execution)
- `time` - Return current date/time
- Zod schema validation for parameters

### 1.4 Agent Loop
- Implement core agent loop: receive → LLM call → tool execution → respond
- Use Vercel AI SDK for LLM abstraction (generateText)
- While loop with max iterations safety limit

### 1.5 HTTP Endpoint
- Hono server on port 4000
- `GET /health` - Health check
- `POST /chat` - Send message, get response
- Test with curl before adding channels

---

## Phase 2: Self-Improvement Foundation

Enable the agent to modify its own codebase through controlled PRs.

**Goal:** Agent can propose code changes via GitHub PRs.

### 2.1 First Channel (WhatsApp via Twilio)
- WhatsApp adapter using Twilio API (webhook-based)
- Plain text output formatting (markdown stripping, 1600-char chunking)
- Session key derivation from phone number (`whatsapp_{phone}`)
- Dynamic system prompt with channel-specific context injection

### 2.2 Coding Tools
- `read` - Read file contents
- `edit` - Edit files (search/replace)
- `write` - Create new files
- `bash` - Execute shell commands
- `glob` - Find files by pattern
- `grep` - Search file contents

### 2.3 GitHub Integration Tools
- `github_clone` - Clone repo to isolated workspace
- `github_branch` - Create feature branch
- `github_commit` - Commit changes
- `github_pr` - Open pull request
- `github_pr_status` - Check CI/review status

### 2.4 Coding Sub-Agent
- Spawn isolated sub-agent for coding tasks
- Workspace isolation (cloned repo, not live)
- PR-only boundary (no direct merge)

### 2.5 OpenCode Skills
- `.opencode/skills/` directory structure
- Skill loading and registration
- Basic skills: code review, refactor suggestions

### 2.6 Self-Repo Detection
- Detect when operating on FERN_SELF_REPO
- Enforce PR requirement for self-modifications
- Block dangerous operations (merge, deploy)

---

## Phase 3: Memory System

Give the agent long-term recall beyond session history.

**Goal:** Agent can remember facts across sessions and retrieve relevant context.

### 3.1 Async Archival Layer (Compaction Shadow)
- Invisible async observer that captures conversation chunks before OpenCode compacts them
- Fires after each agent turn (non-blocking, fire-and-forget)
- Chunks conversation history into ~25k token segments
- Summarizes each chunk via gpt-4o-mini (~10-20k tokens → ~1k summary)
- Stores {summary, original_messages} pairs to `~/.fern/memory/archives/`
- Watermark tracking per thread to avoid re-archiving
- Per-thread PQueue serialization prevents concurrent archival

### 3.2 Memory Search & Retrieval Tools
- `memory_search` - Weighted term matching on summary index, returns ranked results
- `memory_read` - Read full original messages from an archived chunk

### 3.3 Persistent Memory
- SQLite database (`~/.fern/memory/fern.db`) via `better-sqlite3` + `sqlite-vec`
- `memory_write` tool for agent-created memories (facts, preferences, learnings)
- Embedded with OpenAI `text-embedding-3-small` for semantic retrieval
- Internal HTTP API (`/internal/memory/*`) proxies DB operations for OpenCode tool compatibility

### 3.4 Vector Storage & Hybrid Search
- `sqlite-vec` extension for vector similarity search (cosine distance)
- Hybrid scoring: vector similarity (0.7 weight) + FTS5 keyword (0.3 weight)
- Unified search across both archived summaries and persistent memories
- OpenAI `text-embedding-3-small` (1536-dim) embeddings

---

## Phase 4: Observability

Make the agent's behavior transparent and debuggable.

**Goal:** Full visibility into what the agent did and why.

### 4.1 Tool Execution Logging
- `tools.jsonl` per session
- Log: tool name, args, result, duration, cache hit
- Structured for easy querying

### 4.2 Session Metadata
- Token usage tracking
- Cost calculation (when pricing available)
- Error counts and types

### 4.3 Observability UI (Future)
- Web UI to browse sessions
- Session timeline view
- Tool execution drill-down
- Memory browser

---

## Phase 5: Scheduling

Allow the agent to schedule future tasks.

**Goal:** Agent can defer work, set reminders, run periodic jobs.

### 5.1 Job Queue
- JSONL or SQLite job storage
- Job schema: id, scheduledAt, payload, status

### 5.2 Schedule Tool
- `schedule` - Create scheduled job
- Support: absolute time, relative delay, cron expression

### 5.3 Scheduler Loop
- Background check every minute
- Trigger session when job is due
- Mark job complete after execution

### 5.4 Use Cases
- "Remind me tomorrow at 9am"
- "Check on PR #42 in 2 hours"
- Weekly self-review cron

---

## Phase 6: Tool System Enhancements

Optimize tool execution for speed and efficiency.

**Goal:** Faster agent responses through parallelism and caching.

### 6.1 Tool Classification
- Classify tools as `read` or `write`
- Read tools: side-effect-free, parallelizable
- Write tools: sequential execution

### 6.2 Parallel Execution
- Batch read tools from single LLM response
- Execute reads in parallel (Promise.all)
- Execute writes sequentially

### 6.3 Tool Result Caching
- LRU cache keyed by tool + args hash
- Per-tool TTL configuration
- Write tools invalidate related read caches

### 6.4 Background Tasks & Parallel Subagents
- Task orchestrator for spawning multiple subagents concurrently
- Background execution with notification-based completion (non-blocking)
- Main agent remains responsive while workers execute in parallel

---

## Phase 7: Multi-Channel Support

Expand beyond Telegram to other platforms.

**Goal:** Same agent accessible from multiple interfaces.

### 7.1 Channel Abstraction
- Unified ChannelAdapter interface
- `receive()`, `send()`, `getCapabilities()`
- Channel-agnostic core

### 7.2 WhatsApp Adapter
- ~~Baileys library integration~~ Implemented in Phase 2.1 using Twilio
- Plain text formatting (no markdown)
- Message chunking for length limits (1600 chars per Twilio)

### 7.3 WebChat Adapter
- WebSocket server
- Full markdown support
- Real-time streaming

### 7.4 Channel Prompts
- Per-channel system prompt injection
- Tone and formatting hints
- Stored in config

### 7.5 Channel Queue
- One active run per session
- Queue messages during execution
- Process queue on completion

---

## Phase 8: Advanced Features

Polish and production-readiness.

**Goal:** Robust, reliable, cost-aware agent.

### 8.1 Provider Failover
- Multiple auth profiles per provider
- Model fallback chain (Claude → GPT-4 → Gemini)
- Profile cooldown on failures

### 8.2 Retry Logic
- Exponential backoff for rate limits
- Respect Retry-After headers
- Configurable max retries

### 8.3 Cost Tracking
- Token counting per message
- Cost calculation by provider/model
- Budget alerts (session, daily, monthly)

### 8.4 Permission System
- Base profiles (coding, messaging, minimal)
- Channel-level restrictions
- Path-level overrides

### 8.5 Custom Tools
- User-defined tools in `tools/` directory
- Hot-reload on file change
- Zod schema validation

---

## Progress Checklist

### Phase 1: MVP Core
- [x] Configuration system (JSON5 + env vars)
- [x] Session storage (OpenCode file-based)
- [x] Toy tools (echo, time)
- [x] Agent loop implementation
- [x] OpenCode SDK integration (migrated from Vercel AI SDK)
- [x] HTTP endpoint (Hono server)
- [x] OpenCode embedded server with event streaming

### Phase 2: Self-Improvement
- [x] WhatsApp adapter (Twilio) + dynamic system prompt
- [x] Enable coding tools (read, edit, write, bash, glob, grep) - **Enabled in OpenCode config**
- [x] GitHub integration tools (github_clone, github_branch, github_commit, github_push, github_pr, github_pr_status)
- [x] Workspace isolation (temp directory cloning with auto-cleanup)
- [x] Self-repo safety rules (documented in system prompt)
- [ ] Coding sub-agent (future: could spawn isolated OpenCode sessions for complex tasks)
- [ ] OpenCode skills directory (future: .opencode/skills/ for self-improvement patterns)

**Note**: GitHub App authentication configured with Octokit. PRs created by "Fern" GitHub App. All code modifications happen in isolated workspaces, never touching the live codebase.

### Phase 3: Memory System
- [x] Async archival observer (chunks + summarizes conversation history)
- [x] Archive storage (chunk files, watermarks, JSONL summary index)
- [x] Token estimation from OpenCode messages
- [x] LLM summarization via gpt-4o-mini (direct API call)
- [x] memory_search tool (hybrid vector + FTS5 search)
- [x] memory_read tool (full chunk transcript retrieval)
- [x] Memory config (env var overrides, thresholds)
- [x] `pnpm run memory:wipe` dev utility
- [x] Persistent agent-written memory (memory_write tool)
- [x] Embedding-based semantic search (OpenAI text-embedding-3-small)
- [x] SQLite + sqlite-vec vector store (better-sqlite3)
- [x] Internal HTTP API for OpenCode tool compatibility
- [x] JSONL → SQLite migration (auto on first startup)

### Phase 4: Observability
- [ ] Tool execution logging
- [ ] Session metadata tracking
- [ ] Token/cost tracking
- [ ] Observability UI

### Phase 5: Scheduling
- [x] Job queue storage (SQLite `scheduled_jobs` table in existing memory DB)
- [x] `schedule` tool (create jobs with scheduledAt, delayMs, or cronExpr)
- [x] `schedule_list` and `schedule_cancel` tools
- [x] `send_message` tool (proactive channel messaging from any session)
- [x] Scheduler loop (background `setInterval`, PQueue concurrency)
- [x] Cron expression support (`cron-parser` v5)
- [x] Internal HTTP APIs (`/internal/scheduler/*`, `/internal/channel/send`)
- [x] CI: parallel `test-scheduler` job

### Phase 6: Tool Enhancements
- [ ] Read/write classification
- [ ] Parallel read execution
- [ ] Tool result caching
- [ ] Cache invalidation
- [ ] Background task execution
- [ ] Parallel subagent spawning

### Phase 7: Multi-Channel
- [x] Channel abstraction (ChannelAdapter interface + format utilities)
- [x] WhatsApp adapter (implemented in Phase 2.1 via Twilio)
- [ ] WebChat adapter
- [x] Channel prompts (implemented in Phase 2.1 via dynamic system prompt)
- [ ] Channel queue

### Phase 8: Advanced
- [ ] Provider failover
- [ ] Retry with backoff
- [ ] Cost tracking
- [ ] Permission system
- [ ] Custom tool loading

---

## Getting Started

Start with Phase 1. Each phase builds on the previous.

```bash
# Build the project
pnpm run build

# Start the server (requires .env with OPENAI_API_KEY)
pnpm run start

# Test with curl
curl http://localhost:4000/health
curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What time is it?"}'
```

The self-improvement loop (Phase 2) enables the agent to help implement subsequent phases.
