# Fern

A self-improving headless AI agent with multi-channel support (Telegram, WhatsApp, etc.), persistent memory, and the ability to modify its own codebase through controlled PR submissions.

## Current Status

**Phase 1 MVP is complete.** See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for full roadmap.

### What's Working
- Agent loop: message → LLM (gpt-4o-mini) → tool execution → response
- Session storage: JSONL in `~/.fern/sessions/{sessionId}/`
- HTTP API: Hono server on port 4000 (`/health`, `/chat`)
- Toy tools: `echo`, `time`

### Next Up (Phase 2)
- Telegram adapter (grammyjs)
- Coding tools (read, edit, write, bash, glob, grep)
- GitHub integration for self-improvement

## Quick Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Build TypeScript
pnpm run start        # Start server (needs .env with OPENAI_API_KEY)
pnpm run lint         # Run Biome linter
pnpm run tsc          # Type check
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, starts Hono server |
| `src/core/agent.ts` | Main agent loop with LLM calls |
| `src/storage/session.ts` | JSONL session persistence |
| `src/tools/registry.ts` | Tool definitions for AI SDK |
| `src/server/server.ts` | HTTP routes |
| `src/config/config.ts` | Config loading |

## Patterns Established

### Tool Definition
Tools are defined inline in `registry.ts` using Vercel AI SDK's `tool()`:
```typescript
tool({
  description: "...",
  parameters: z.object({ ... }),
  execute: async (args) => result,
})
```

### Session Storage
- Events appended to `events.jsonl` (user_message, assistant_message, tool_call, tool_result)
- Metadata in `metadata.json`
- Session ID is ULID

### Agent Loop
- Uses `generateText` with `maxSteps: 5` for automatic tool execution
- While loop with max 10 iterations as safety
- Messages converted to CoreMessage format for AI SDK

## Reference Projects

These were used for inspiration (in `/Users/ezraapple/Projects/`):
- **opencode**: Agent loop pattern, tool interface, config structure
- **openclaw**: Provider abstraction, event-driven architecture

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design with diagrams.

**Key layers:**
- **Core Runtime**: Agent loop, session manager, provider manager
- **Tool Executor**: Parallel read execution, sequential writes, result caching
- **Memory System**: Session memory (JSONL) + persistent memory (markdown + vector)
- **Channel Adapters**: Telegram, WhatsApp, WebChat, webhooks
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
│   ├── channels/       # Channel adapters (TODO)
│   ├── memory/         # Persistent memory (TODO)
│   └── scheduler/      # Cron system (TODO)
├── config/             # Config files
├── agent-docs/         # AI development guidance
├── ARCHITECTURE.md     # System design
└── IMPLEMENTATION_PLAN.md  # Roadmap with checklist
```

## Known Issues / Gotchas

- `exactOptionalPropertyTypes` disabled in tsconfig due to AI SDK type conflicts
- Tool calls handled internally by AI SDK's `maxSteps` - we don't see intermediate tool calls in response
- Node 20 works despite package.json saying 22+ (just a warning)
