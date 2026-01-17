# Jarvis

Local-first AI assistant for software development. Uses [OpenCode](https://opencode.ai/) as the agentic harness with GitHub integration for self-improvement capabilities.

## Features

- **CLI Interface**: Ask questions and run tasks directly from the command line
- **Local API Server**: HTTP API for integration with custom clients
- **GitHub Integration**: Responds to PR comments and can create pull requests
- **Tool-based Agent**: Uses OpenCode's tool loop for capable task execution

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Bundle OpenCode tools (required before first run)
node scripts/bundle-tools.mjs

# 4. Run the CLI
pnpm dev ask "your question here"

# 5. Or start the local API server
pnpm dev serve
```

## Configuration

See `.env.example` for all environment variables.

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (temporary, Phase 3 switches to Ollama) |
| `GITHUB_TOKEN` | GitHub personal access token with `repo` and `read:user` scopes |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `WEBHOOK_PORT` | Local API server port | `7829` |
| `DEBUG` | Enable debug logging | - |

### GitHub App Authentication (Alternative)

For higher rate limits, you can use GitHub App authentication instead of a personal access token:

```bash
GITHUB_APP_ID=your-app-id
GITHUB_APP_PRIVATE_KEY=your-private-key
GITHUB_APP_INSTALLATION_ID=your-installation-id
```

## Usage

### CLI Commands

```bash
# Check configuration
pnpm dev config

# Check service connectivity
pnpm dev health

# Ask a question
pnpm dev ask "explain this codebase"

# Ask with repository context
pnpm dev ask -r owner/repo "fix the bug in auth.ts"

# Start the local API server
pnpm dev serve
pnpm dev serve --port 8080
```

### Local API Server

Start the server:

```bash
pnpm dev serve
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Send a message to the agent |
| `GET` | `/api/health` | Health check |
| `POST` | `/webhooks/github` | GitHub webhook handler |

#### POST /api/chat

```bash
curl -X POST http://localhost:7829/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you do?"}'
```

## Project Structure

```
core/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── webhook-server.ts        # HTTP API server
│   ├── agents/
│   │   ├── chat-agent.ts        # Main agent orchestration
│   │   ├── handlers/            # Platform-specific handlers
│   │   └── prompts/             # System and platform prompts
│   ├── services/
│   │   ├── integrations/        # External service clients
│   │   │   ├── github.ts        # GitHub API client
│   │   │   └── opencode.ts      # OpenCode engine wrapper
│   │   └── cache.ts             # In-memory cache
│   ├── .opencode/
│   │   └── tool/                # Custom OpenCode tools (TypeScript)
│   └── .opencode-runtime/
│       └── tool/                # Bundled tools (generated JavaScript)
├── scripts/
│   └── bundle-tools.mjs         # Tool bundler script
└── .env.example                 # Environment template
```

## Development

### Building

```bash
# TypeScript compilation
pnpm build

# Run built version
pnpm start ask "your question"
```

### Tool Development

Custom tools are defined in `src/.opencode/tool/` as TypeScript files. After modifying tools:

```bash
node scripts/bundle-tools.mjs
```

This compiles them to `src/.opencode-runtime/tool/` where OpenCode auto-discovers them.

### Linting

```bash
pnpm lint
pnpm typecheck
```

## Architecture

See [architecture.md](../architecture.md) for the full system design.

## Roadmap

See [migration-plan.md](../migration-plan.md) for the full roadmap:

- **Phase 2** (current): Local development setup
- **Phase 3**: Ollama integration for local model inference
- **Phase 4**: Electron chat client
- **Phase 5**: Local persistence and self-improvement workflows

## License

MIT
