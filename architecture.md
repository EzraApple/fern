# Architecture

Jarvis is a local-first AI assistant for software development. It uses OpenCode as its agentic harness with GitHub as the primary integration for self-improvement capabilities.

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL TRIGGERS                                   │
├──────────────┬──────────────┬──────────────────────────────────────────────────┤
│    GitHub    │    CLI       │    Future: Custom Clients                        │
│  PR comments │   commands   │    (Voice, Chat UI, etc.)                        │
│   reviews    │              │                                                  │
└──────┬───────┴──────┬───────┴──────────────────────────────────────────────────┘
       │              │
       ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WEBHOOK SERVER (Express)                               │
│                                                                                  │
│  POST /webhooks/github   POST /webhooks/linear (stubbed)                        │
│  POST /webhooks/notion (stubbed)   GET /health                                  │
│                                                                                  │
│  • Signature verification     • Event filtering      • Bot loop prevention      │
│  Note: Linear/Notion endpoints kept for future mocking of progress tracking     │
└──────────────────────────────────────────────────┬──────────────────────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CHAT AGENT                                          │
│                                                                                  │
│  Unified conversational agent for all platforms                                 │
│                                                                                  │
│  ┌────────────────┐  ┌────────────────┐                                        │
│  │ Progress       │  │ Status         │                                        │
│  │ Handler        │  │ Throttler      │                                        │
│  │ (GitHub)       │  │                │                                        │
│  └────────────────┘  └────────────────┘                                        │
│                                                                                  │
│  Features:                                                                       │
│  • Session continuity (threads)       • Real-time status updates               │
└──────────────────────────────────────────────────┬──────────────────────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           OPENCODE (AI Engine)                                   │
│                                                                                  │
│  Self-hosted OpenCode server managing AI sessions                               │
│                                                                                  │
│  • Session lifecycle (create, prompt, events, cleanup)                          │
│  • Event streaming (tool calls, text, thinking, completion)                     │
│  • Model provider: OpenAI (temporary) → Ollama (Phase 3)                        │
│  • Auto-permission approval for automated operation                             │
│                                                                                  │
│  Built-in Tools:                                                                 │
│  bash, edit, write, read, grep, glob, list, patch, webfetch, todowrite/read    │
│                                                                                  │
│  Custom Tools:                                                                   │
│  repo_*, github_*                                                               │
└──────────────────────────────────────────────────┬──────────────────────────────┘
                                                   │
                       ┌───────────────────────────┼───────────────────────────┐
                       │                           │                           │
                       ▼                           ▼                           ▼
          ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
          │   GitHub API       │     │   Built-in Tools   │     │   Future: Ollama   │
          │                    │     │                    │     │                    │
          │ • Repository ops   │     │ • bash             │     │ • Local models     │
          │ • PR management    │     │ • file operations  │     │ • Privacy-first    │
          │ • Comments/reviews │     │ • grep/glob        │     │ • No API costs     │
          │                    │     │ • webfetch         │     │                    │
          └────────────────────┘     └────────────────────┘     └────────────────────┘
```

## Core Components

### `core/` — The AI Agent

All source code lives in the `core/` directory:

| Directory | Purpose |
|-----------|---------|
| `src/agents/` | Chat agent orchestration, GitHub handler, prompt building |
| `src/services/integrations/` | GitHub and OpenCode clients |
| `src/webhook-server.ts` | Express HTTP server for webhooks |
| `src/index.ts` | CLI entry point |
| `src/.opencode/` | Custom OpenCode tools (github, repo, utils) |

### Integration Architecture

The agent connects to external services via:

**1. GitHub REST API** (`src/services/integrations/github.ts`)

TypeScript client wrapping GitHub API with retry logic and type safety.

- Repository operations (clone, checkout, commit, push)
- Pull request management (create, comment, review)
- Comment reactions

**2. OpenCode Engine** (`src/services/integrations/opencode.ts`)

Self-hosted OpenCode server providing:
- Session management
- Event streaming
- Tool execution
- Model routing (OpenAI for now, Ollama in Phase 3)

### Event Flow

1. **Inbound**: GitHub webhook or CLI command
2. **Validation**: Signature verification, bot-loop prevention
3. **Processing**: Chat Agent runs with context
4. **AI Execution**: OpenCode manages session, streams events, calls tools
5. **Response**: GitHub handler posts comment/reaction

### Key Patterns

**Session Continuity**: Thread IDs map to OpenCode sessions for multi-turn conversations.

**Progress Streaming**: Real-time status updates via StatusThrottler.

**Tool Auto-Discovery**: Custom tools in `${OPENCODE_CONFIG_DIR}/tool/` loaded automatically.

## Local Development

```bash
# Install dependencies
pnpm install

# Run CLI
pnpm dev ask "your question"

# Run webhook server
pnpm dev:webhooks
```

## Configuration

Environment variables (see `.env.example`):

- `GITHUB_TOKEN` — GitHub personal access token
- `OPENAI_API_KEY` — OpenAI API key (temporary, Phase 3 switches to Ollama)
- `WEBHOOK_PORT` — Local webhook server port (default: 7829)

## Future Phases

See `migration-plan.md` for the full roadmap:

- **Phase 2**: Monorepo structure, simplified local job handling
- **Phase 3**: Ollama integration for local model inference
- **Phase 4**: Electron chat client
- **Phase 5**: Local persistence and self-improvement workflows
