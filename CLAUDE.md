# Fern

A self-improving headless AI agent with multi-channel support (Telegram, WhatsApp, etc.), persistent memory, and the ability to modify its own codebase through controlled PR submissions.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design with diagrams.

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
│   ├── core/           # Agent loop, session manager, provider manager
│   ├── tools/          # Tool definitions and executor
│   ├── memory/         # Session + persistent memory
│   ├── channels/       # Channel adapters
│   ├── scheduler/      # Cron/scheduling system
│   └── self-improve/   # Coding sub-agent, GitHub integration
├── docs/               # Architecture documentation
├── agent-docs/         # Development guidance (this index)
├── config/             # Configuration templates
└── tests/
```

## Quick Commands

```bash
# Install (when implemented)
npm install

# Run (when implemented)
npm start

# Test (when implemented)
npm test
```
