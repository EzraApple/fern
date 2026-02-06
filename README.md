# 🌿
# Fern

A self-improving headless AI agent that operates across multiple messaging channels (Telegram, WhatsApp, etc.) with persistent memory, parallel tool execution, and the ability to improve its own codebase through controlled PR submissions.

## Current Functionality

Phase 1 MVP + WhatsApp channel:

- **Agent Loop**: Core message → LLM → tool execution → response cycle
- **Session Storage**: JSONL-based conversation persistence with metadata
- **Toy Tools**: `echo` and `time` tools for testing
- **HTTP API**: Hono server with `/health`, `/chat`, and `/webhooks/whatsapp` endpoints
- **WhatsApp Channel**: Twilio-based WhatsApp integration with webhook
- **Dynamic System Prompt**: Personality and tool descriptions loaded from `config/SYSTEM_PROMPT.md`
- **Configuration**: JSON5 config + .env support

### Quick Start

```bash
# Clone and install
git clone git@github.com:EzraApple/fern.git
cd fern
pnpm install

# Set up environment
# Required: OpenAI API key
# Optional: Twilio credentials for WhatsApp
cat > .env << 'EOF'
OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
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

## Planned Features

- **Multi-Channel Support**: Telegram, WebChat, webhooks (WhatsApp done)
- **Coding Tools**: read, edit, write, bash, glob, grep
- **Memory System**: Persistent agent-written knowledge with vector search
- **Parallel Tool Execution**: Read operations in parallel, writes sequential
- **Tool Result Caching**: LRU cache with write-invalidation
- **Self-Improvement Loop**: Agent modifies its own code via PRs
- **Observability**: JSONL logs with UI viewer
- **Unified Permissions**: Profile + channel + path-level permission layers
- **Scheduling**: Built-in cron for scheduled tasks and follow-ups

## Project Structure

```
fern/
├── src/
│   ├── index.ts        # Entry point
│   ├── core/           # Agent loop
│   ├── config/         # Configuration loading
│   ├── storage/        # JSONL session storage
│   ├── tools/          # Tool definitions
│   ├── server/         # HTTP server (Hono)
│   ├── channels/       # Channel adapters (WhatsApp via Twilio)
│   ├── memory/         # Persistent memory (coming soon)
│   └── scheduler/      # Cron/scheduling (coming soon)
├── config/             # Configuration files
├── agent-docs/         # AI development guidance
└── ARCHITECTURE.md     # System design with diagrams
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
- [Implementation Plan](IMPLEMENTATION_PLAN.md) - Phased roadmap
- [Agent Docs](agent-docs/) - Guides for AI-assisted development

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
