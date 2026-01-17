# Replee

AI assistant that fixes Sentry errors and Linear tickets using [OpenCode](https://opencode.ai/) agents.

## Features

- **Slack Bot**: `@bot fix <url>` to fix Sentry issues or Linear tickets
- **Linear Integration**: Responds to @mentions and assignments
- **GitHub Integration**: Responds to PR comments and review comments
- **Google Calendar**: Manage calendar events via natural language
- **Automated PRs**: Creates pull requests with proper descriptions
- **Trigger.dev**: Background task execution

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy and configure environment
cp .env.example .env

# Development
pnpm dev:trigger    # Start Trigger.dev worker
pnpm dev:webhooks   # Start webhook server

# Production
pnpm build
pnpm deploy:trigger
```

## Configuration

See `.env.example` for all required environment variables:

```bash
# Core
TRIGGER_SECRET_KEY=tr_dev_xxx
GEMINI_API_KEY=your-gemini-api-key

# Sentry
SENTRY_AUTH_TOKEN=sntrys_xxx
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug

# Linear
LINEAR_ACCESS_TOKEN=lin_oauth_xxx
LINEAR_CLIENT_ID=xxx
LINEAR_CLIENT_SECRET=xxx
LINEAR_WEBHOOK_SECRET=lin_wh_xxx
LINEAR_BOT_USER_ID=xxx
LINEAR_DEFAULT_TEAM_KEY=REPL

# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_WEBHOOK_SECRET=xxx
SSH_PRIVATE_KEY=  # Optional: base64 encoded, for cloud/Trigger.dev

# Slack
SLACK_BOT_TOKEN=xoxb-xxx
SLACK_SIGNING_SECRET=xxx

# Exa (web search)
EXA_API_KEY=xxx

# Google Calendar (optional)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REFRESH_TOKEN=xxx
GOOGLE_CALENDAR_ID=primary  # Optional, defaults to primary

# Upstash Redis
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Webhooks
WEBHOOK_PORT=3000
NGROK_DOMAIN=your-subdomain.ngrok.app
```

## Usage

### Slack

```
@bot fix https://replo-hq.sentry.io/issues/123456
@bot fix ENG-123
@bot plan ENG-456
```

### Linear

- **@mention**: Comment `@Replee fix this` on any issue
- **Assignment**: Assign an issue to the bot user

#### Linear Bot Setup

To enable assignment-based triggers, you need a Linear bot user:

1. **Create an OAuth app in Linear** (Settings → API → OAuth Applications)
2. **Get the bot user ID** by querying the API with your OAuth token:
   ```bash
   curl -s -X POST "https://api.linear.app/graphql" \
     -H "Authorization: Bearer $LINEAR_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query": "{ users { nodes { id name email isMe } } }"}'
   ```
   The bot user is the one with `isMe: true` and an `@oauthapp.linear.app` email.
3. **Set `LINEAR_BOT_USER_ID`** in your environment
4. **Assign issues to this user** to trigger the bot

### GitHub

Comment on any PR and the bot will respond.

### Google Calendar

```
@bot what's on my calendar this week?
@bot schedule a meeting with John tomorrow at 2pm
@bot create "Team Standup" every weekday at 9am
@bot when am I free on Friday?
```

See [docs/GOOGLE_CALENDAR_SETUP.md](docs/GOOGLE_CALENDAR_SETUP.md) for setup instructions.

## Project Structure

```
src/
├── index.ts                 # CLI entry point
├── webhook-server.ts        # HTTP webhook server
├── trigger/
│   ├── process-issues.ts    # Sentry processing
│   ├── slack-commands.ts    # Slack handlers
│   ├── linear-webhooks.ts   # Linear handlers
│   └── github-webhooks.ts   # GitHub handlers
├── agents/
│   ├── chat-agent.ts        # Main agent (handles all sources)
│   └── feedback-agent.ts    # PR feedback handler
├── services/
│   ├── git.ts               # Git operations
│   └── integrations/        # API clients
└── types/
    └── index.ts

.opencode/tool/              # OpenCode tools
├── github.ts                # GitHub PR tools
├── linear.ts                # Linear issue tools
├── sentry.ts                # Sentry issue tools
├── slack.ts                 # Slack messaging
├── google-calendar.ts       # Calendar management
└── repo.ts                  # Git/repo operations
```

## Webhook Endpoints

```
POST /webhooks/linear   # Linear events
POST /webhooks/slack    # Slack events
POST /webhooks/github   # GitHub events
GET  /health            # Health check
```

## Deployment

### GitHub Actions (Automatic)

Pushing to `main` automatically deploys to Trigger.dev production.

Required GitHub secrets:
- `TRIGGER_ACCESS_TOKEN` - Trigger.dev access token

### Manual Deployment

```bash
# Deploy to staging
pnpm dlx trigger.dev@latest deploy --env staging

# Deploy to production
pnpm dlx trigger.dev@latest deploy --env prod
```

### Doppler (Secrets Management)

```bash
# Setup (first time)
doppler setup

# Switch to production
doppler setup --config prd

# Run with Doppler secrets
doppler run -- pnpm dev:trigger
```

## License

MIT
