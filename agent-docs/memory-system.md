---
name: Memory System
description: |
  How the Jarvis memory system works - session and persistent memory.
  Reference when: working with session memory, persistent memory, memory search/read, compaction, vector storage.
---

# Memory System

Jarvis has two types of memory:

1. **Session Memory** - Conversation history (JSONL per session)
2. **Persistent Memory** - Agent-written knowledge (markdown + vector index)

## Session Memory

### Storage Format

Each session is stored as a JSONL file:

```
sessions/{channelId}_{userId}/session.jsonl
```

Each line is an event:

```jsonl
{"type":"message","role":"user","content":"Hello","timestamp":"..."}
{"type":"message","role":"assistant","content":"Hi there!","timestamp":"..."}
{"type":"tool_call","toolName":"read","args":{"path":"..."},"timestamp":"..."}
{"type":"tool_result","toolCallId":"tc_123","result":"...","timestamp":"..."}
```

### Session Metadata

Metadata is stored separately:

```
sessions/{channelId}_{userId}/metadata.json
```

```json
{
  "id": "session_abc123",
  "channelId": "telegram_12345",
  "userId": "user_67890",
  "messageCount": 42,
  "tokenCount": 15000,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-02T12:00:00Z"
}
```

### Context Window Management

Session memory is loaded into context for each LLM call. When approaching limits:

1. **Soft limit** - Trigger compaction agent
2. **Hard limit** - Truncate oldest messages

## Persistent Memory

### Storage Format

Agent-written memories are markdown files:

```
memory/{memoryId}.md
```

```markdown
---
id: mem_abc123
type: fact
tags: [user_preference, settings]
createdAt: 2024-01-01T00:00:00Z
---

User prefers dark mode and concise responses.
```

### Vector Index

Memories are embedded and indexed in LanceDB for semantic search:

```typescript
// Vector store structure
{
  id: string,
  content: string,
  embedding: number[],
  metadata: {
    type: string,
    tags: string[],
    createdAt: string,
  }
}
```

## Memory Tools

### memory_search

Returns summaries and IDs for relevant memories:

```typescript
const results = await memory_search({
  query: "user preferences for UI",
  limit: 5,
});

// Returns:
[
  {
    id: "mem_abc123",
    summary: "User prefers dark mode and concise responses",
    relevance: 0.92,
    timestamp: "2024-01-01T00:00:00Z",
  },
  // ...
]
```

### memory_read

Returns full content of a specific memory (paginated):

```typescript
const memory = await memory_read({
  id: "mem_abc123",
  offset: 0,
  limit: 1000, // characters
});

// Returns full markdown content
```

### memory_write

Creates or updates a persistent memory:

```typescript
await memory_write({
  type: "fact",
  tags: ["user_preference"],
  content: "User's timezone is PST",
});
```

## Two-Step Memory Access Pattern

For efficient context usage:

1. **Search first** - Get summaries and IDs
2. **Read if needed** - Fetch full content only when necessary

```typescript
// Agent workflow
const searchResults = await memory_search({ query: "user timezone" });

// Only read full content if summary isn't enough
if (needsMoreDetail(searchResults[0])) {
  const fullMemory = await memory_read({ id: searchResults[0].id });
}
```

## Compaction

When session context exceeds limits:

### Compaction Flow

1. Compaction agent summarizes old conversation
2. Summary is saved as a new message
3. Old messages are archived (not deleted)
4. Summary is indexed in vector store

```typescript
// Compaction trigger
if (sessionTokenCount > COMPACTION_THRESHOLD) {
  const summary = await compactionAgent.summarize(oldMessages);

  // Replace old messages with summary
  session.archive(oldMessages);
  session.addMessage({
    role: "system",
    content: `Previous conversation summary:\n${summary}`,
  });

  // Index for future retrieval
  await vectorStore.index({
    content: summary,
    metadata: { type: "session_summary", sessionId },
  });
}
```

### Compaction Threshold

```typescript
const COMPACTION_THRESHOLD = 100_000; // tokens
const PROTECTED_RECENT = 20_000; // tokens (recent messages protected)
```

## Hybrid Search

Memory search uses hybrid (vector + keyword) matching:

```typescript
async function hybridSearch(query: string, limit: number) {
  const vectorResults = await vectorStore.search(query, limit * 2);
  const keywordResults = await keywordIndex.search(query, limit * 2);

  // Combine with weights
  const combined = mergeResults(vectorResults, keywordResults, {
    vectorWeight: 0.7,
    keywordWeight: 0.3,
  });

  return combined.slice(0, limit);
}
```

## Anti-Patterns

### Don't: Read full memory without searching first

```typescript
// Bad - loads everything
const allMemories = await getAllMemories();
const relevant = allMemories.filter(m => m.content.includes(query));

// Good - search first
const relevant = await memory_search({ query });
```

### Don't: Store transient data in persistent memory

```typescript
// Bad - this belongs in session
await memory_write({
  content: "User just asked about the weather",
});

// Good - only store lasting knowledge
await memory_write({
  content: "User lives in Seattle, WA",
});
```

### Don't: Skip compaction until overflow

```typescript
// Bad - reactive compaction
if (contextOverflow) {
  compact();
}

// Good - proactive compaction
if (tokenCount > COMPACTION_THRESHOLD) {
  compact();
}
```
