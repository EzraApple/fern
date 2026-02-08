---
name: Session Management
description: |
  How Fern manages sessions - JSONL format, context window, channel queues.
  Reference when: working with session storage, managing context, handling concurrent messages, session lifecycle.
---

# Session Management

## Session Key Derivation

Sessions are keyed by channel + user:

```typescript
function deriveSessionKey(channelId: string, userId: string): string {
  return `${channelId}_${userId}`;
}

// Examples:
// telegram_12345_user_67890
// whatsapp_15551234567_user_abc
// webchat_session_xyz_user_123
```

## JSONL Session Format

### File Structure

```
sessions/
├── telegram_12345_user_67890/
│   ├── session.jsonl      # Conversation events
│   ├── metadata.json      # Session metadata
│   └── tools.jsonl        # Tool execution log (for observability)
├── whatsapp_15551234567_user_abc/
│   └── ...
```

### Event Types

```typescript
type SessionEvent =
  | { type: "message"; role: "user" | "assistant"; content: string; timestamp: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: unknown; timestamp: string }
  | { type: "tool_result"; toolCallId: string; result: string; timestamp: string }
  | { type: "system"; content: string; timestamp: string }
  | { type: "compaction"; summary: string; archivedCount: number; timestamp: string };
```

### Example Session

```jsonl
{"type":"system","content":"Session started","timestamp":"2024-01-01T10:00:00Z"}
{"type":"message","role":"user","content":"What files are in src/?","timestamp":"2024-01-01T10:00:01Z"}
{"type":"tool_call","toolCallId":"tc_1","toolName":"glob","args":{"pattern":"src/**/*"},"timestamp":"2024-01-01T10:00:02Z"}
{"type":"tool_result","toolCallId":"tc_1","result":"src/index.ts\nsrc/config.ts","timestamp":"2024-01-01T10:00:03Z"}
{"type":"message","role":"assistant","content":"The src/ directory contains:\n- index.ts\n- config.ts","timestamp":"2024-01-01T10:00:04Z"}
```

## Session Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Create    │ ──▶ │   Active    │ ──▶ │  Archived   │
│  (on first  │     │ (messages   │     │ (compacted  │
│   message)  │     │  flowing)   │     │  or idle)   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Compacted  │
                    │ (summary    │
                    │  replaces   │
                    │  old msgs)  │
                    └─────────────┘
```

### Create

```typescript
async function createSession(channelId: string, userId: string): Promise<Session> {
  const key = deriveSessionKey(channelId, userId);
  const session = {
    id: generateId(),
    key,
    channelId,
    userId,
    createdAt: new Date().toISOString(),
  };

  await writeMetadata(key, session);
  await appendEvent(key, { type: "system", content: "Session started", timestamp: now() });

  return session;
}
```

### Load

```typescript
async function loadSession(key: string): Promise<SessionWithHistory> {
  const metadata = await readMetadata(key);
  const events = await readJsonl(key);

  return {
    ...metadata,
    history: eventsToMessages(events),
  };
}
```

## Context Window Management

### Token Counting

```typescript
function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}

function getSessionTokenCount(session: SessionWithHistory): number {
  return session.history.reduce(
    (sum, msg) => sum + estimateTokens(msg.content),
    0
  );
}
```

### Compaction Trigger

```typescript
const CONTEXT_LIMIT = 128_000;  // Model context window
const OUTPUT_RESERVE = 8_000;   // Reserved for output
const COMPACTION_THRESHOLD = CONTEXT_LIMIT - OUTPUT_RESERVE - 20_000;

async function maybeCompact(session: SessionWithHistory): Promise<void> {
  const tokenCount = getSessionTokenCount(session);

  if (tokenCount > COMPACTION_THRESHOLD) {
    await compactSession(session);
  }
}
```

### Compaction Process

OpenCode handles live context compaction internally. Fern adds an **async archival layer** that captures conversation chunks *before* they're lost to compaction:

- After each agent turn, the archival observer checks if unarchived tokens exceed the chunk threshold (~25k)
- If so, it summarizes the oldest unarchived chunk via gpt-4o-mini and stores {summary, messages} to `~/.fern/memory/`
- This is non-blocking (fire-and-forget) and independent of OpenCode's compaction
- See [memory-system.md](memory-system.md) for full details

```typescript
// In agent.ts, after getLastResponse():
void onTurnComplete(input.sessionId, sessionId).catch((err) => {
  console.warn("[Memory] Archival observer error:", err);
});
```
```

## Channel Queue

Only one agent run per session at a time:

```typescript
class SessionQueue {
  private running = new Map<string, boolean>();
  private queues = new Map<string, InboundMessage[]>();

  async enqueue(message: InboundMessage): Promise<void> {
    const key = deriveSessionKey(message.channelId, message.userId);

    if (this.running.get(key)) {
      // Queue for later
      const queue = this.queues.get(key) ?? [];
      queue.push(message);
      this.queues.set(key, queue);
      return;
    }

    // Process now
    await this.process(key, message);
  }

  private async process(key: string, message: InboundMessage): Promise<void> {
    this.running.set(key, true);

    try {
      await runAgentLoop(key, message);
    } finally {
      this.running.set(key, false);

      // Process queued messages
      const queue = this.queues.get(key);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        await this.process(key, next);
      }
    }
  }
}
```

## Session Metadata

```typescript
interface SessionMetadata {
  id: string;
  key: string;
  channelId: string;
  userId: string;
  messageCount: number;
  tokenCount: number;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
  lastCompactedAt?: string;
  status: "active" | "archived";
}
```

Update metadata after each interaction:

```typescript
async function updateMetadata(key: string, updates: Partial<SessionMetadata>): Promise<void> {
  const current = await readMetadata(key);
  await writeMetadata(key, {
    ...current,
    ...updates,
    updatedAt: now(),
  });
}
```

## Tool Execution Log

Separate log for observability:

```
sessions/{key}/tools.jsonl
```

```jsonl
{"toolName":"read","args":{"path":"src/index.ts"},"durationMs":45,"cacheHit":false,"timestamp":"..."}
{"toolName":"read","args":{"path":"src/index.ts"},"durationMs":2,"cacheHit":true,"timestamp":"..."}
{"toolName":"edit","args":{"path":"src/index.ts"},"durationMs":120,"success":true,"timestamp":"..."}
```

## Anti-Patterns

### Don't: Load full session for every operation

```typescript
// Bad - loads everything
const session = await loadFullSession(key);
const lastMessage = session.history[session.history.length - 1];

// Good - use metadata or tail
const metadata = await readMetadata(key);
const lastEvents = await tailJsonl(key, 1);
```

### Don't: Skip the queue

```typescript
// Bad - concurrent runs on same session
await Promise.all([
  runAgentLoop(key, message1),
  runAgentLoop(key, message2),
]);

// Good - use queue
await sessionQueue.enqueue(message1);
await sessionQueue.enqueue(message2);
```

### Don't: Wait until overflow to compact

```typescript
// Bad - reactive
if (error.code === "CONTEXT_OVERFLOW") {
  await compactSession(session);
}

// Good - proactive
if (getSessionTokenCount(session) > COMPACTION_THRESHOLD) {
  await compactSession(session);
}
```
