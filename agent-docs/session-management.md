---
name: Session Management
description: |
  How Fern manages sessions via OpenCode SDK.
  Reference when: working with session storage, understanding context window management, session lifecycle, thread mapping.
---

# Session Management

## Overview

Sessions are managed by the OpenCode SDK. Fern maps channel+user combinations to OpenCode thread IDs for conversation continuity.

## Session Key Derivation

Each channel adapter derives a session key from channel-specific identifiers:

```typescript
// WhatsApp: phone number → session key
adapter.deriveSessionId("+15551234567")  // → "whatsapp_+15551234567"
```

## OpenCode Session Storage

OpenCode manages session data in `~/.local/share/opencode/storage/`:

```
~/.local/share/opencode/storage/
├── project/          # Project-level metadata
├── session/          # Session records
├── message/          # Individual messages
├── part/             # Message parts (text, tool calls, reasoning)
└── session_diff/     # File diffs tracked per session
```

Fern does **not** manage session files directly — it interacts via the OpenCode SDK client API.

## Thread-Based Session Mapping

Fern maintains a mapping from channel session keys to OpenCode thread IDs:

```typescript
// In src/core/agent.ts
// channelSessionKey → OpenCode threadId
const sessionMap = new Map<string, string>();
```

- On first message from a channel+user, a new OpenCode session is created and the mapping is stored
- On subsequent messages, the existing OpenCode thread is reused for conversation continuity
- Sessions have a 1-hour TTL for reuse — after that, a new session is created

## Session Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Create    │ ──▶ │   Active    │ ──▶ │  Expired    │
│  (first msg │     │ (messages   │     │  (1hr TTL   │
│   from user)│     │  flowing)   │     │   exceeded) │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Archived   │
                    │ (memory     │
                    │  observer   │
                    │  captures)  │
                    └─────────────┘
```

## Context Window Management

OpenCode handles context compaction internally when the conversation exceeds the model's context window. Fern adds a separate **async archival layer** that captures conversation history *before* it's lost to compaction:

- After each agent turn, the archival observer checks if unarchived tokens exceed the chunk threshold (~25k)
- If so, it summarizes the oldest unarchived chunk via gpt-4o-mini and stores it in the memory DB
- This is non-blocking (fire-and-forget) and independent of OpenCode's compaction
- See [memory-system.md](memory-system.md) for full details

```typescript
// In agent.ts, after getLastResponse():
void onTurnComplete(input.sessionId, sessionId).catch((err) => {
  console.warn("[Memory] Archival observer error:", err);
});
```

## Dashboard Session Access

The dashboard API (`src/server/dashboard-api.ts`) exposes session data for the observability UI:

```
GET  /api/sessions              → list all sessions
GET  /api/sessions/:id          → session detail
GET  /api/sessions/:id/messages → full message history
```

These endpoints read directly from OpenCode's storage via the OpenCode service client (`src/core/opencode-service.ts`).

## Anti-Patterns

### Don't: Access OpenCode storage files directly

```typescript
// Bad - reading session files directly
const data = fs.readFileSync("~/.local/share/opencode/storage/session/...");

// Good - use OpenCode service client
const session = await getSession(sessionId);
const messages = await getSessionMessages(sessionId);
```

### Don't: Skip the archival hook

```typescript
// Bad - no memory capture
const response = await runAgentLoop(input);
return response;

// Good - fire archival observer after each turn
const response = await runAgentLoop(input);
void onTurnComplete(threadId, sessionId).catch(console.warn);
return response;
```
