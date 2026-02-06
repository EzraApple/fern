# Fern

A self-improving headless AI agent with multi-channel support (Telegram, WhatsApp, etc.), persistent memory, and the ability to modify its own codebase through controlled PR submissions.

## Current Status

**Phase 1 MVP is complete.** See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for full roadmap.

### What's Working
- Agent loop: message → OpenCode SDK → tool execution → response
- Session storage: OpenCode file-based storage in `~/.local/share/opencode/storage/`
- HTTP API: Hono server on port 4000 (`/health`, `/chat`, `/webhooks/whatsapp`)
- Tools: `echo`, `time` + 6 GitHub tools + built-in coding tools (read, edit, write, bash, glob, grep)
- WhatsApp channel via Twilio (webhook-based)
- Dynamic system prompt from `config/SYSTEM_PROMPT.md` with self-improvement workflow
- OpenCode embedded server (port 4096-4300)
- **Phase 2: Self-improvement loop** - Agent can clone repos, modify code, run tests, create PRs via GitHub App

### Next Up (Phase 3)
- Memory system (persistent memory, vector search)
- Observability (tool execution logging, session metadata)

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
| `src/index.ts` | Entry point, starts Hono server and OpenCode, workspace cleanup |
| `src/core/agent.ts` | Main agent loop using OpenCode SDK |
| `src/core/opencode-service.ts` | OpenCode server/client management, event streaming |
| `src/core/github-service.ts` | GitHub App authentication, PR creation, status checking (Octokit) |
| `src/core/workspace.ts` | Workspace lifecycle (create, cleanup, stale detection) |
| `src/core/workspace-git.ts` | Git operations in workspace (branch, commit, push) |
| `src/types/workspace.ts` | Workspace and git commit type definitions |
| `src/.opencode/tool/` | Tool definitions (OpenCode auto-discovery) |
| `src/.opencode/tool/github-*.ts` | 6 GitHub tools for self-improvement workflow |
| `src/server/server.ts` | HTTP routes |
| `src/server/webhooks.ts` | Twilio WhatsApp webhook route |
| `src/config/config.ts` | Config loading (includes GitHub App credentials) |
| `src/core/prompt.ts` | System prompt loading, tool injection, channel prompts |
| `config/SYSTEM_PROMPT.md` | Agent personality, self-improvement workflow, safety rules |
| `src/channels/whatsapp/adapter.ts` | WhatsApp adapter (Twilio) |
| `src/channels/whatsapp/twilio-gateway.ts` | Twilio API wrapper |
| `src/channels/format.ts` | Markdown stripping, message chunking |
| `src/channels/types.ts` | Shared channel interfaces |

## Patterns Established

### Tool Definition
Tools are defined in `src/.opencode/tool/` using OpenCode plugin format:
```typescript
import { tool } from "@opencode-ai/plugin";

export const echo = tool({
  description: "...",
  args: {
    text: tool.schema.string().describe("..."),
  },
  async execute(args) {
    return args.text;
  },
});
```

Tools are auto-discovered by OpenCode at startup (no registry needed).

### Session Storage
- OpenCode manages sessions in `~/.local/share/opencode/storage/`
- File-based: `project/`, `session/`, `message/`, `part/`, `session_diff/`
- Tracks file diffs, message parts, and git integration
- Thread-based session continuity (maps channel session → OpenCode threadId)
- 1-hour TTL for session reuse

### Agent Loop
- OpenCode SDK handles everything: LLM calls, tool execution, conversation history
- Event streaming for real-time progress (tool_start, tool_complete, session_idle)
- Embedded server on port 4096-4300 (retry logic on conflict)
- Thread-based session mapping for conversation continuity across messages

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

### Workspace Isolation (Phase 2)
- All code modifications happen in isolated temp workspaces, never touching live codebase
- Workspace location: `os.tmpdir()/fern-workspaces/{ulid}/`
- Lifecycle: create → branch → modify → test → commit → push → PR → cleanup
- Git operations confined to workspace via `cwd` option
- Auto-cleanup on process exit and stale workspace detection on startup
- Self-repo URL documented in system prompt (https://github.com/EzraApple/fern)

### GitHub Integration (Phase 2)
- GitHub App authentication via Octokit (`@octokit/app`)
- PRs created by "Fern" GitHub App (not user account)
- 6 tools: `github_clone`, `github_branch`, `github_commit`, `github_push`, `github_pr`, `github_pr_status`
- Branch protection enforced (PR-only merges to main)
- All operations validated and errors surfaced to agent for handling

## Reference Projects

These were used for inspiration (in `/Users/ezraapple/Projects/`):
- **opencode**: Agent loop pattern, tool interface, config structure
- **openclaw**: Provider abstraction, event-driven architecture

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design with diagrams.

**Key layers:**
- **Core Runtime**: OpenCode SDK manages agent loop, sessions, and tool execution
- **OpenCode Service**: Embedded server, client management, event streaming
- **Tools**: Auto-discovered from `.opencode/tool/` directory
- **Channel Adapters**: WhatsApp (Twilio), WebChat (planned)
- **Self-Improvement**: PR-only code modifications with human approval (Phase 2)

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
