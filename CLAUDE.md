# Fern

A self-improving headless AI agent with multi-channel support (Telegram, WhatsApp, etc.), persistent memory, and the ability to modify its own codebase through controlled PR submissions.

## Current Status

**Phase 1 MVP is complete.** See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for full roadmap.

### What's Working
- Agent loop: message → LLM (gpt-4o-mini) → tool execution → response
- Session storage: JSONL in `~/.fern/sessions/{sessionId}/`
- HTTP API: Hono server on port 4000 (`/health`, `/chat`, `/webhooks/whatsapp`)
- Toy tools: `echo`, `time`
- WhatsApp channel via Twilio (webhook-based)
- Dynamic system prompt from `config/SYSTEM_PROMPT.md` with tool injection and channel-specific context

### Next Up (Phase 2 continued)
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
| `src/server/webhooks.ts` | Twilio WhatsApp webhook route |
| `src/config/config.ts` | Config loading |
| `src/core/prompt.ts` | System prompt loading, tool injection, channel prompts |
| `config/SYSTEM_PROMPT.md` | Agent personality and instructions template |
| `src/channels/whatsapp/adapter.ts` | WhatsApp adapter (Twilio) |
| `src/channels/whatsapp/twilio-gateway.ts` | Twilio API wrapper |
| `src/channels/format.ts` | Markdown stripping, message chunking |
| `src/channels/types.ts` | Shared channel interfaces |

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
│   ├── channels/       # Channel adapters (WhatsApp via Twilio)
│   ├── memory/         # Persistent memory (TODO)
│   └── scheduler/      # Cron system (TODO)
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
