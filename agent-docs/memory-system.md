---
name: Memory System
description: |
  How the Fern memory system works - async archival layer, persistent memory, hybrid search, and the HTTP proxy architecture.
  Reference when: working with memory archival, search/retrieval tools, SQLite DB, embeddings, storage layout.
---

# Memory System

Fern has a two-layer memory architecture backed by SQLite + sqlite-vec:

1. **Archival Memory** - Async shadow layer that captures, summarizes, embeds, and stores conversation chunks
2. **Persistent Memory** - Agent-written knowledge base (facts, preferences, learnings) via `memory_write` tool

Both layers share the same SQLite database (`~/.fern/memory/fern.db`) with vector search via `sqlite-vec` and keyword search via FTS5.

## Architecture: HTTP Proxy Pattern

OpenCode tools run inside OpenCode's embedded Go binary JS runtime, which **cannot** load native Node modules (`better-sqlite3`, `node:sqlite`). To solve this:

- **Fern server process**: Has direct access to `better-sqlite3` and `sqlite-vec`. Exposes internal HTTP API at `/internal/memory/*`.
- **OpenCode tools**: Use `fetch()` to call the fern server's internal API instead of importing DB code directly.

```
OpenCode Runtime (Go binary)          Fern Server (Node.js)
┌────────────────────────┐            ┌────────────────────────┐
│  memory_write tool     │──fetch()──→│ /internal/memory/write │
│  memory_search tool    │──fetch()──→│ /internal/memory/search│
│  memory_read tool      │──fetch()──→│ /internal/memory/read  │
└────────────────────────┘            └─────────┬──────────────┘
                                                │
                                      ┌─────────▼──────────────┐
                                      │  better-sqlite3        │
                                      │  + sqlite-vec          │
                                      │  + OpenAI embeddings   │
                                      └────────────────────────┘
```

Tool URL resolution: `FERN_API_URL` env var, or `http://127.0.0.1:${FERN_PORT || 4000}`.

## Archival Memory (Async Shadow Layer)

### How It Works

An invisible async observer shadows each OpenCode session. After every agent turn:

1. Fetches all messages from the OpenCode session
2. Checks the watermark (how far archival has progressed for this thread)
3. If unarchived messages exceed the chunk threshold (~25k tokens):
   - Pops the oldest unarchived chunk
   - Summarizes it via gpt-4o-mini (~10-20k tokens → ~1k summary)
   - Embeds the summary via OpenAI text-embedding-3-small
   - Stores summary + embedding in SQLite, original messages as JSON file
   - Advances the watermark

This runs as fire-and-forget — it never blocks the agent response.

### Hook Point

In `src/core/agent.ts`, after `getLastResponse()`:

```typescript
void onTurnComplete(input.sessionId, sessionId).catch((err) => {
  console.warn("[Memory] Archival observer error:", err);
});
```

### Storage Layout

```
~/.fern/memory/
  fern.db                          # SQLite database (summaries, memories, FTS5, vec0)
  archives/
    {threadId}/                    # e.g., "whatsapp_+1234567890"
      watermark.json               # Archival progress tracker
      chunks/
        chunk_{ulid}.json          # {id, summary, messages[], tokenCount, messageRange}
```

## Persistent Memory

Agent-written memories stored in SQLite with embeddings:

```typescript
await memory_write({
  type: "fact",       // "fact" | "preference" | "learning"
  content: "User's timezone is PST",
  tags: ["timezone", "user-info"],
});
```

Each memory gets:
- Unique ID (`mem_{ulid}`)
- OpenAI embedding for semantic search
- FTS5 index entry for keyword search
- Stored in `memories`, `memories_fts`, and `memories_vec` tables

## Database Schema

```sql
-- Archival summaries
summaries (id, thread_id, summary, token_count, created_at, time_start, time_end)
summaries_fts (summary, id, thread_id)     -- FTS5 virtual table
summaries_vec (id, embedding FLOAT[1536])  -- sqlite-vec virtual table

-- Persistent memories
memories (id, type, content, tags, created_at, updated_at)
memories_fts (content, id, type)           -- FTS5 virtual table
memories_vec (id, embedding FLOAT[1536])   -- sqlite-vec virtual table
```

## Hybrid Search

Search uses a weighted combination of vector similarity and FTS5 keyword matching:

```
final_score = 0.7 × vector_score + 0.3 × fts5_score
```

1. **Embed query** via OpenAI text-embedding-3-small
2. **Vector search**: `vec_distance_cosine()` on `summaries_vec` and `memories_vec`
3. **FTS5 search**: `bm25()` ranking on `summaries_fts` and `memories_fts`
4. **Merge by ID**: Combine scores for results found by both methods
5. **Filter**: Drop results below minimum score threshold (0.05)
6. **Sort**: Return top N by combined score

If vector search is unavailable (sqlite-vec failed to load), falls back to FTS5-only.

### Key Files

| File | Purpose |
|------|---------|
| `src/memory/db.ts` | SQLite singleton (better-sqlite3 + sqlite-vec), schema, CRUD |
| `src/memory/embeddings.ts` | OpenAI text-embedding-3-small wrapper |
| `src/memory/persistent.ts` | Persistent memory CRUD (writeMemory, deleteMemory, etc.) |
| `src/memory/search.ts` | Hybrid vector + FTS5 search engine |
| `src/memory/observer.ts` | Core archival logic, per-thread PQueue |
| `src/memory/storage.ts` | File I/O for chunks and watermarks |
| `src/memory/summarizer.ts` | gpt-4o-mini summarization (direct OpenAI call) |
| `src/memory/tokenizer.ts` | Token estimation from OpenCode messages |
| `src/memory/config.ts` | Configuration with env var overrides |
| `src/memory/types.ts` | ArchiveChunk, PersistentMemory, UnifiedSearchResult, etc. |
| `src/server/memory-api.ts` | Internal HTTP API endpoints for tools |

### Configuration

Defaults (overridable via env vars):

| Setting | Default | Env Var |
|---------|---------|---------|
| Enabled | `true` | `FERN_MEMORY_ENABLED` |
| Storage path | `~/.fern/memory` | `FERN_MEMORY_PATH` |
| DB path | `~/.fern/memory/fern.db` | (derived from storage path) |
| Chunk threshold | 25,000 tokens | `FERN_MEMORY_CHUNK_TOKENS` |
| Summarization model | `gpt-4o-mini` | `FERN_MEMORY_MODEL` |
| Embedding model | `text-embedding-3-small` | `FERN_MEMORY_EMBEDDING_MODEL` |

## Memory Tools

### memory_write

Save a persistent memory:

```typescript
const result = await memory_write({
  type: "preference",
  content: "User prefers dark mode in all apps",
  tags: ["ui", "theme"],
});
// → "Memory saved: mem_01KGXGQNBT... [preference] User prefers dark mode..."
```

### memory_search

Search across both archives and persistent memories:

```typescript
const results = await memory_search({
  query: "user preferences for UI",
  limit: 5,
});
// Returns unified results from both sources with relevance scores
```

### memory_read

Read full original messages from an archived chunk:

```typescript
const transcript = await memory_read({
  chunkId: "chunk_01HWXYZ...",
  threadId: "whatsapp_+1234567890",
});
// Returns formatted transcript with summary + full messages
```

## Two-Phase Retrieval Pattern

For efficient context usage:

1. **Search first** — Get summaries and chunk IDs via `memory_search`
2. **Read if needed** — Fetch full original messages only when the summary isn't enough

This gives the agent "perfect memory" — it can find relevant history quickly, then drill into exact details when needed.

## Dev Utilities

```bash
pnpm run memory:wipe  # Delete all archived memories + DB (for clean dev cycles)
```

## Anti-Patterns

### Don't: Read full memory without searching first

```typescript
// Bad - loads everything
const allChunks = getAllChunks();

// Good - search first, read specific chunks
const results = await memory_search({ query: "deployment config" });
const details = await memory_read({ chunkId: results[0].chunkId, threadId: results[0].threadId });
```

### Don't: Block the agent loop on archival

```typescript
// Bad - blocks response
await onTurnComplete(threadId, sessionId);

// Good - fire and forget
void onTurnComplete(threadId, sessionId).catch(console.warn);
```

### Don't: Import DB code in OpenCode tools

```typescript
// Bad - native module won't load in OpenCode's runtime
import { writeMemory } from "../../memory/persistent.js";

// Good - use HTTP proxy to fern server
const res = await fetch(`${getFernUrl()}/internal/memory/write`, { ... });
```
