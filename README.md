<!-- CI retrigger -->
#
# Phase 2 Self-Improvement Test
#
# Fern 🌿

<!-- secret-test-comment: if you found this, hi 👋 -->

A self-improving headless AI agent that operates across multiple messaging channels (Telegram, WhatsApp, etc.) with persistent memory, parallel tool execution, and the ability to improve its own codebase through controlled PR submissions.

## Current Functionality

All core phases complete (MVP, Self-Improvement, Memory, Observability, Scheduling):

- **Agent Loop**: OpenCode SDK-powered message → LLM → tool execution → response cycle
- **Session Storage**: OpenCode file-based storage in `~/.local/share/opencode/storage/`
- **Tools**: `echo`, `time` + 6 GitHub tools + 3 memory tools + 3 scheduling tools + `send_message` + built-in coding tools (read, edit, write, bash, glob, grep)
- **HTTP API**: Hono server with `/health`, `/chat`, `/webhooks/whatsapp`, and `/api/*` dashboard endpoints
- **WhatsApp Channel**: Twilio-based WhatsApp integration with webhook
- **Dynamic System Prompt**: Personality, tool descriptions, and self-improvement workflow from `config/SYSTEM_PROMPT.md`
- **Self-Improvement Loop**: Agent can clone repos, modify code in isolated workspaces, run tests, and create PRs via GitHub App
- **Workspace Isolation**: All code modifications in temp directories (`/tmp/fern-workspaces/`) with auto-cleanup
- **GitHub Integration**: Authenticated via GitHub App, PRs created as "Fern" bot
- **Memory System**: SQLite + sqlite-vec powered memory with OpenAI embeddings. Async archival layer captures conversation chunks. Persistent `memory_write` for facts/preferences/learnings. Hybrid vector + FTS5 search (`memory_search` → `memory_read`)
- **Scheduling**: SQLite job queue with background polling loop. `schedule` tool creates one-shot or recurring (cron) jobs. Each job stores a self-contained prompt that fires a fresh agent session with full tool access. `send_message` tool enables proactive outbound messaging to any channel.
- **Observability Dashboard**: Next.js 15 app (`apps/dashboard/`) with views for sessions, memory, tool analytics, GitHub PRs, and cost tracking. Backed by a public dashboard API on the Fern server.
- **Configuration**: JSON5 config + .env support for API keys, GitHub App credentials, and memory settings

### Quick Start

```bash
# Clone and install
git clone git@github.com:EzraApple/fern.git
cd fern
pnpm install

# Set up environment
# Required: OpenAI API key
# Optional: Twilio credentials for WhatsApp
# Optional: GitHub App credentials for self-improvement
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."
GITHUB_APP_INSTALLATION_ID=12345678
EOF

# Build and run
pnpm run build
pnpm run start
```

### Test the API

```bash
# Health check
curl http://localhost:4000/health

# Chat (creates new session)
curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What time is it?"}'

# Continue conversation (use sessionId from previous response)
curl -X POST http://localhost:4000/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "YOUR_SESSION_ID", "message": "What did I just ask?"}'
```

### WhatsApp (with Twilio Sandbox)

1. Sign up at [twilio.com](https://www.twilio.com/try-twilio) (free trial works)
2. Add Twilio credentials to `.env` (see Quick Start above)
3. Join the Twilio sandbox: send `join <your-code>` to the sandbox number from WhatsApp
4. Start Fern, then expose it with ngrok:
   ```bash
   ngrok http 4000
   ```
5. Set the Twilio sandbox webhook to `https://<ngrok-url>/webhooks/whatsapp` (POST)
6. Send a WhatsApp message to the sandbox number

---

## Project Structure

```
fern/                          # pnpm monorepo
├── src/
│   ├── index.ts               # Entry point
│   ├── core/                  # Agent loop, GitHub service, workspace management
│   ├── config/                # Configuration loading
│   ├── server/                # HTTP server (Hono), dashboard API, internal APIs
│   ├── channels/              # Channel adapters (WhatsApp via Twilio)
│   ├── memory/                # Async archival, persistent memory, hybrid search
│   ├── scheduler/             # Job scheduling (types, config, db, loop)
│   └── .opencode/tool/        # 14 tools (auto-discovered by OpenCode)
├── apps/
│   └── dashboard/             # Next.js 15 observability dashboard
├── config/                    # Configuration files + system prompt
├── agent-docs/                # AI development guidance
└── ARCHITECTURE.md            # System design with diagrams
```

## Development Setup

Requirements:
- Node.js 20+ (22+ recommended)
- pnpm
- OpenAI API key (for gpt-4o-mini testing)
- Twilio account (optional, for WhatsApp — free trial works)
- ngrok (optional, for local WhatsApp testing)

## Documentation

- [Architecture](ARCHITECTURE.md) - Detailed system design with diagrams

- [Agent Docs](agent-docs/) - Guides for AI-assisted development

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core runtime | Single Node process | Simplicity, no distributed state |
| Session storage | OpenCode file-based | Managed by OpenCode SDK, tracks diffs/parts/messages |
| Tool system | OpenCode auto-discovery + HTTP proxy | Auto-loaded from `.opencode/tool/`, native modules via internal API |
| Memory (archival) | Async observer + JSON chunks + SQLite + embeddings | Captures history before compaction, two-phase retrieval |
| Memory (persistent) | SQLite + sqlite-vec + OpenAI embeddings | Agent-writable, vector-searchable facts/preferences/learnings |
| Scheduling | SQLite + setInterval + PQueue | Prompt-based jobs, agent autonomy, no external deps |
| Channels | Adapter pattern | Add channels without core changes |
| Self-improvement | PR-only, no direct merge | Safety boundary, human in loop |
| Observability | Dashboard API + Next.js app | Reads from existing stores, no separate logging |
| Monorepo | pnpm workspaces | Root (agent) + apps/dashboard |

## License

MIT
