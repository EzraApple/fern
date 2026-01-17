# Migration Plan: Local-First Jarvis

## Goals

Transform the hosted Replee architecture into a **local-first personal AI assistant** that:

1. **Runs entirely on local hardware** — Uses Ollama or native model weights instead of cloud providers (Claude, Gemini, Grok), eliminating API costs and preserving privacy
2. **Preserves the agentic harness** — Keeps OpenCode's robust tool loop, enabling capable task execution despite "weaker" local models
3. **Maintains self-improvement capability** — Retains GitHub integration so the agent can create PRs for its own repository
4. **Supports multiple interfaces** — Exposes the agent through custom clients (voice, chat, etc.) beyond the original webhook-triggered pattern
5. **Persists conversations** — Stores chat history locally for continuity across sessions

---

## Migration Checklist

### Phase 1: Strip to Core ✅
- [x] **Remove cloud deployment infrastructure.** Deleted Fly.io configs, Doppler integration, GitHub Actions deploy workflows, Dockerfile, and cron scripts.
- [x] **Remove all business integrations.** Deleted HubSpot, Ashby, Gem, Brex, Fathom, Dub, Loom, HeyGen, Braintrust, YouTube, Pylon, Apollo, and their OpenCode tools.
- [x] **Remove productivity integrations.** Deleted Google Calendar, Google Sheets, Exa, and image hosting integrations.
- [x] **Remove webhook-triggered platforms.** Deleted Slack, Linear, Notion, and Sentry handlers, services, and OpenCode tools. Kept webhook server structure with Linear/Notion endpoints stubbed for future mocking.
- [x] **Remove MCP servers.** Deleted all MCP configurations (Grafana, PostHog, Trigger.dev, Playwright, replo-admin).
- [x] **Remove Trigger.dev.** Deleted all trigger tasks and removed Trigger.dev dependencies.
- [x] **Simplify configuration.** Updated config to only require GitHub + OpenAI API keys. Created .env.example template.
- [x] **Update package.json.** Removed unused dependencies, simplified scripts, renamed to "jarvis".
- [x] **Validate minimal state.** Codebase stripped to core agent with GitHub tools and built-in OpenCode tools.

### Phase 2: Refactor for Local Development
- [ ] **Evaluate job queue needs.** Determine if background jobs are needed or if direct execution is sufficient for local use.
- [ ] **Set up monorepo structure.** Initialize Turborepo at root with pnpm workspaces. Move core agent into `packages/core/` and prepare `packages/` for future shared utilities.
- [ ] **Create root orchestration.** Add root `package.json` with scripts to start all services locally (agent, future clients) via Turborepo.
- [ ] **Simplify the webhook server.** Convert the Express server from a webhook receiver to a local HTTP API that clients can call directly to trigger agent sessions.
- [ ] **Establish local config pattern.** Create a unified config loader that reads from `.env` and provides typed config objects.

### Phase 3: Local Model Integration
- [ ] **Configure Ollama as primary provider.** Update OpenCode configuration to route requests to a local Ollama instance instead of OpenAI.
- [ ] **Set up model routing for local models.** Adapt model selection logic to use appropriate local model weights (e.g., Llama, Mistral, CodeLlama).
- [ ] **Test agent loop with local models.** Validate that the full agentic loop (tool calls, reasoning, multi-turn) functions correctly with local models.

### Phase 4: Chat Client
- [ ] **Create clients directory structure.** Set up `clients/` at repo root with its own package for client applications.
- [ ] **Build minimal Electron chat app.** Create a simple chat interface that communicates with the local agent API.
- [ ] **Add session management to client.** Implement ability to create new sessions, continue existing sessions, and view session history.
- [ ] **Wire client to agent API.** Connect the Electron app to the local HTTP API, triggering agent sessions and displaying streamed responses.

### Phase 5: Persistence & Self-Improvement Foundation
- [ ] **Implement local chat persistence.** Store conversation history in SQLite or flat files.
- [ ] **Add memory/context retrieval.** Create a mechanism for the agent to search and retrieve relevant past conversations.
- [ ] **Document self-improvement workflow.** Establish the pattern for the agent to propose changes to its own codebase via GitHub PRs.
- [ ] **Set up evaluation framework.** Create simple local benchmarks to measure agent capability.

---

## Previous Work

### Phase 1 Completion Summary

**Date:** January 2026

**What was done:**
- Stripped the Replee codebase from a full-featured hosted service to a minimal local-first agent
- Removed ~50+ files including all business integrations, cloud deployment configs, and company-specific tooling
- Kept only GitHub integration and core OpenCode functionality
- Simplified the webhook server to have stubbed Linear/Notion endpoints (for potential future progress tracking mocking)
- Configured OpenAI as temporary model provider until Phase 3 switches to Ollama

**Key decisions:**
1. **Kept webhook server structure**: Rather than delete entirely, stubbed out Linear/Notion endpoints. This preserves the HTTP server pattern for future use and allows potential mocking of these services for progress tracking/persistence.
2. **OpenAI as bridge**: Using OpenAI API temporarily to validate the stripped codebase works before switching to local models. This allows faster iteration on Phase 1.
3. **Removed all MCP servers**: None of the MCP servers (Playwright, Grafana, PostHog, etc.) are needed for local-first operation. Can be re-added individually if needed.
4. **Removed Trigger.dev entirely**: The background job queue was only needed for cloud webhook processing. Local use can execute directly.

**Files kept in core:**
- `src/index.ts` — CLI entry point
- `src/webhook-server.ts` — HTTP server (GitHub active, Linear/Notion stubbed)
- `src/agents/chat-agent.ts` — Main agent orchestration
- `src/agents/handlers/github-handler.ts` — GitHub progress handler
- `src/agents/prompts/` — System and platform prompts
- `src/services/integrations/github.ts` — GitHub API client
- `src/services/integrations/opencode.ts` — OpenCode engine wrapper
- `src/services/integrations/git.ts` — Git operations
- `src/services/cache.ts` — In-memory cache
- `src/.opencode/tool/github.ts`, `repo.ts`, `utils.ts` — Custom tools

**Notes for future phases:**
- The OpenCode configuration still references some paths that may need adjustment
- The agent prompts are simplified but may need further tuning for local models
- Consider whether the webhook server should become a general-purpose local API

---

## Current Focus

### Active: Phase 2 — Refactor for Local Development

**Status:** Not started

**Next Steps:**
1. Test that `pnpm install && pnpm dev` boots the core agent
2. Decide on monorepo structure (Turborepo vs simpler approach)
3. Evaluate if background job handling is needed at all for local use

---

## Reference

- See `architecture.md` for the updated system design
- Core agent entry point: `core/src/index.ts`
- OpenCode tools: `core/src/.opencode/tool/`
- GitHub integration: `core/src/services/integrations/github.ts`
