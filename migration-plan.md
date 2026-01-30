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

### Phase 2: Refactor for Local Development ✅
- [x] **Evaluate job queue needs.** Determined that direct execution is sufficient for local use; no background job queue needed.
- [x] **Clean up Trigger.dev remnants.** Removed trigger.config.ts, Trigger.dev-specific comments, path logic, and knip configuration.
- [x] **Simplify the webhook server.** Converted Express server to a local HTTP API with `POST /api/chat`, `GET /api/health`, and `POST /webhooks/github` endpoints.
- [x] **Add CLI serve command.** Added `pnpm dev serve` command to start the local API server.
- [x] **Establish local config pattern.** Created `.env.example` template, added dotenv loading to entry points for proper environment variable handling.
- [x] **Update documentation.** Replaced README.md with local-first setup instructions, updated AGENTS.md and CLAUDE.md.
- [x] **Simplify OpenCode integration.** Removed cloud-specific path logic and streamlined runtime directory configuration.
- [ ] **Set up monorepo structure.** _(Deferred to future phase — not needed until multiple clients exist)_

### Phase 3: Local Model Integration ✅
- [x] **Configure Ollama as primary provider.** Updated OpenCode configuration to use `@ai-sdk/openai-compatible` with Ollama endpoint.
- [x] **Set up model routing for local models.** Configured `qwen3-vl:32b` as default model across all task types.
- [x] **Add Ollama lifecycle management.** Added startup script to auto-start Ollama and warm model, plus shutdown hooks to unload model from VRAM.
- [x] **Test agent loop with local models.** Validated config, health checks, and agent session creation with local Ollama.

### Phase 4: Chat Client
- [ ] **Create clients directory structure.** Set up `clients/` at repo root with its own package for client applications.
- [ ] **Build minimal Electron chat app.** Create a simple chat interface that communicates with the local agent API.
- [ ] **Add session management to client.** Implement ability to create new sessions, continue existing sessions, and view session history.
- [ ] **Wire client to agent API.** Connect the Electron app to the local HTTP API, triggering agent sessions and displaying streamed responses.

### Phase 5: Persistence & Self-Improvement Foundation
- [ ] **Implement local chat persistence.** Store conversation history in SQLite or flat files.
- [ ] **Add memory/context retrieval.** Create a mechanism for the agent to search and retrieve relevant past conversations.
- [ ] **Document self-improvement workflow.** Establish the pattern for the agent to propose changes to its own codebase via GitHub PRs.

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

### Phase 2 Completion Summary

**Date:** January 2026

**What was done:**
- Removed all remaining Trigger.dev artifacts (config file, comments, path logic, knip entries)
- Converted webhook server into a local HTTP API with `/api/chat` and `/api/health` endpoints
- Added `serve` CLI command to start the local API server on configurable port
- Established dotenv-based configuration pattern with `.env.example` template
- Simplified OpenCode service by removing cloud-specific runtime directory logic
- Updated all documentation (README, AGENTS.md, CLAUDE.md) to reflect local-first architecture
- Validated end-to-end functionality with `pnpm dev ask` command

**Key decisions:**
1. **No job queue needed**: Direct execution is sufficient for local use. The original Trigger.dev setup was only necessary for cloud webhook processing with timeouts.
2. **Deferred monorepo**: Turborepo/pnpm workspaces structure postponed until multiple clients exist. Current single-package structure is simpler for now.
3. **OpenAI for validation**: Kept OpenAI (gpt-4o-mini) as temporary provider to validate Phase 2 changes before switching to Ollama in Phase 3.
4. **Webhook server → Local API**: Transformed from webhook receiver to general-purpose local API that any client can call.

**CLI commands available:**
- `pnpm dev ask "question"` — Run agent with a prompt
- `pnpm dev ask -r owner/repo "question"` — Run agent with repository context
- `pnpm dev serve` — Start local API server (default port 7829)
- `pnpm dev config` — Display current configuration
- `pnpm dev health` — Check API connectivity

**API endpoints:**
- `POST /api/chat` — Send message to agent, receive response
- `GET /api/health` — Health check for agent and integrations
- `POST /webhooks/github` — GitHub webhook receiver (for self-improvement PRs)

### Phase 3 Completion Summary

**Date:** January 2026

**What was done:**
- Switched OpenCode provider from OpenAI to Ollama using `@ai-sdk/openai-compatible`
- Set `qwen3-vl:32b` as the default model for all task types
- Created `scripts/ollama.mjs` to auto-start Ollama server and warm the model on `pnpm dev` commands
- Added `unloadOllamaModel()` function to release VRAM on CLI completion and server shutdown
- Made `OPENAI_API_KEY` optional in config schema, added `OLLAMA_BASE_URL` and `OLLAMA_MODEL` env vars
- Updated config command output to show Ollama settings

**Key decisions:**
1. **Ollama via OpenAI-compatible API**: Using `@ai-sdk/openai-compatible` package to connect to Ollama's `/v1` endpoint, which provides OpenAI-compatible API.
2. **Model warmup via API**: Using `/api/generate` with empty prompt and `keep_alive` instead of interactive `ollama run` command.
3. **Graceful unload**: On shutdown, set `keep_alive: 0` to immediately unload model from VRAM rather than stopping Ollama service entirely.
4. **Default model `qwen3-vl:32b`**: Vision-capable model for multimodal tasks, configurable via `OLLAMA_MODEL` env var.

**New files:**
- `core/scripts/ollama.mjs` — Ollama startup/warmup script
- `core/src/services/integrations/ollama.ts` — Ollama service (health check, unload)

**Updated files:**
- `core/src/constants/models.ts` — Default model changed to `ollama/qwen3-vl:32b`
- `core/src/services/integrations/opencode.ts` — Provider config switched to Ollama
- `core/src/config/index.ts` — Added Ollama config, made OpenAI optional
- `core/src/types/index.ts` — Updated config schema
- `core/src/index.ts` — Added unload hook on CLI completion
- `core/src/webhook-server.ts` — Added unload hook on SIGTERM
- `core/package.json` — Added `@ai-sdk/openai-compatible`, updated dev scripts

**CLI commands updated:**
- `pnpm dev ...` now auto-starts Ollama and warms the model before running
- `pnpm ollama:start` — Standalone Ollama startup command

---

## Current Focus

### Active: Phase 4 — Chat Client

**Status:** Not started

**Next Steps:**
1. Create `clients/` directory structure at repo root
2. Build minimal Electron chat app that communicates with local API
3. Add session management for conversation continuity

---

## Reference

- See `architecture.md` for the updated system design
- Core agent entry point: `core/src/index.ts`
- OpenCode tools: `core/src/.opencode/tool/`
- GitHub integration: `core/src/services/integrations/github.ts`
