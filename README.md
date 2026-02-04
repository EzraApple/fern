# Jarvis

A self-improving headless AI agent that operates across multiple messaging channels (Telegram, WhatsApp, etc.) with persistent memory, parallel tool execution, and the ability to improve its own codebase through controlled PR submissions.

## Features

- **Headless Core**: Long-running Node.js process that accepts work from any channel
- **Multi-Channel Support**: Telegram, WhatsApp, WebChat, webhooks - add channels without core changes
- **Memory System**: Session memory (JSONL) + persistent agent-written knowledge (markdown + vector search)
- **Parallel Tool Execution**: Read operations run in parallel, writes sequential
- **Tool Result Caching**: LRU cache with write-invalidation to avoid redundant operations
- **Self-Improvement Loop**: Agent can modify its own code via PRs (never direct merge)
- **Observability**: JSONL files ARE the logs - UI is a viewer over structured data
- **Unified Permissions**: Profile + channel + path-level permission layers
- **Scheduling**: Built-in cron for scheduled tasks and follow-ups

## Quick Start

> Coming soon - project is in scaffold phase

```bash
# Clone the repo
git clone git@github.com:EzraApple/jarvis.git
cd jarvis

# Install dependencies (when implemented)
npm install

# Configure (when implemented)
cp config/example.json5 config/local.json5
# Edit config/local.json5 with your API keys and channel credentials

# Run (when implemented)
npm start
```

## Project Structure

```
jarvis/
├── src/
│   ├── core/           # Agent loop, session manager, provider manager
│   ├── tools/          # Tool definitions and executor
│   ├── memory/         # Session + persistent memory
│   ├── channels/       # Channel adapters (telegram, whatsapp, etc.)
│   ├── scheduler/      # Cron/scheduling system
│   └── self-improve/   # Coding sub-agent, GitHub integration
├── docs/
│   └── architecture.md # Comprehensive architecture documentation
├── agent-docs/         # Development guidance for AI agents working on this codebase
├── config/             # Configuration templates
└── tests/
```

## Development Setup

Requirements:
- Node.js 22+
- LanceDB (for vector memory)
- API keys for LLM providers (Anthropic, OpenAI, etc.)
- Channel credentials (Telegram bot token, WhatsApp via Baileys, etc.)

## Documentation

- [Architecture](docs/architecture.md) - Detailed system design with diagrams
- [Agent Docs](agent-docs/) - Guides for AI-assisted development (coming soon)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core runtime | Single Node process | Simplicity, no distributed state |
| Session storage | JSONL files | Human-readable, append-only, IS the log |
| Memory | Markdown + LanceDB | Agent-writable, vector-searchable |
| Parallelism | Read/write classification | Simple, no graph complexity |
| Caching | LRU with write-invalidation | Easy wins, no stale data |
| Channels | Adapter pattern | Add channels without core changes |
| Self-improvement | PR-only, no direct merge | Safety boundary, human in loop |
| Observability | UI over JSONL | No extra logging, data already structured |

## License

MIT
