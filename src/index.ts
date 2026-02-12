/**
 * Fern - Self-improving headless AI agent
 *
 * Entry point for the Fern agent runtime.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WhatsAppAdapter } from "@/channels/index.js";
import type { ChannelAdapter } from "@/channels/types.js";
import { getTwilioCredentials, loadConfig } from "@/config/index.js";
import { runAgentLoop } from "@/core/agent.js";
import { initAlerts, sendAlert } from "@/core/alerts.js";
import {
  clearDeployState,
  isDeployStateStale,
  readDeployState,
  writeDeployState,
} from "@/core/deploy-state.js";
import { loadBasePrompt } from "@/core/index.js";
import { ensureOpenCode, cleanup as opencodeCleanup } from "@/core/opencode/server.js";
import { initWatchdog, recordOpenCodeFailure, resetOpenCodeFailures } from "@/core/watchdog.js";
import * as workspace from "@/core/workspace.js";
import { closeDb, initMemoryDb } from "@/memory/index.js";
import { initScheduler, stopScheduler } from "@/scheduler/index.js";
import { createServer } from "@/server/index.js";
import { initTasks } from "@/tasks/index.js";
import { serve } from "@hono/node-server";

export const VERSION = "0.2.0";

async function main() {
  const config = loadConfig();

  // Pre-load and cache the system prompt
  loadBasePrompt();

  // Clean up stale workspaces from previous runs
  console.info("Cleaning up stale workspaces...");
  workspace.cleanupStaleWorkspaces(24 * 60 * 60 * 1000); // 24 hours

  // Kill stale opencode processes from previous runs
  try {
    execSync("pkill -f 'opencode serve' 2>/dev/null", { stdio: "ignore" });
  } catch {
    // No stale processes — expected
  }

  // Setup cleanup handler (defined early so watchdog can reference it)
  let shuttingDown = false;
  const cleanup = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.info("\nShutting down...");

    console.info("  Stopping scheduler...");
    stopScheduler();
    console.info("  ✓ Scheduler stopped");

    console.info("  Closing memory database...");
    closeDb();
    console.info("  ✓ Memory database closed");

    console.info("  Cleaning up workspaces...");
    workspace.cleanupAllWorkspaces();
    console.info("  ✓ Workspaces cleaned");

    console.info("  Stopping OpenCode server...");
    await opencodeCleanup();
    console.info("  ✓ OpenCode server stopped");

    // Kill any orphaned opencode child processes
    try {
      execSync("pkill -f 'opencode serve' 2>/dev/null", { stdio: "ignore" });
    } catch {
      // No orphans — expected
    }

    console.info("✓ Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Initialize alert system (uses Twilio directly, not through agent)
  initAlerts();

  // Check for new env vars flagged by the updater
  const newKeysFlag = path.join(os.homedir(), ".fern", "new-env-keys.flag");
  if (fs.existsSync(newKeysFlag)) {
    try {
      const newKeys = fs.readFileSync(newKeysFlag, "utf-8").trim().split("\n").filter(Boolean);
      if (newKeys.length > 0) {
        const keyList = newKeys.join(", ");
        console.warn(`[Startup] New env vars needed: ${keyList} — add them in Doppler`);
        void sendAlert(
          `Update deployed but ${newKeys.length} new env var${newKeys.length > 1 ? "s" : ""} needed in Doppler: ${keyList}`
        );
      }
      fs.unlinkSync(newKeysFlag);
    } catch {
      // Flag file read failed — non-critical, continue startup
    }
  }

  // Initialize watchdog with shutdown handler
  initWatchdog(async (reason: string) => {
    console.error(`[Watchdog] Triggering shutdown: ${reason}`);
    await cleanup();
  });

  // Initialize OpenCode server
  console.info("Initializing OpenCode server...");
  const opencode = await ensureOpenCode();
  resetOpenCodeFailures();
  console.info(`✓ OpenCode server running at ${opencode.url}`);

  // Initialize memory database (SQLite + sqlite-vec + JSONL migration)
  await initMemoryDb();
  console.info("✓ Memory database initialized");

  // Initialize channel adapters
  let whatsappAdapter: WhatsAppAdapter | undefined;
  const channelAdapters = new Map<string, ChannelAdapter>();

  const twilioCreds = getTwilioCredentials();
  if (twilioCreds) {
    whatsappAdapter = new WhatsAppAdapter(twilioCreds);
    await whatsappAdapter.init();
    channelAdapters.set("whatsapp", whatsappAdapter);
  }

  // Check for in-progress deploy (resume verification after restart)
  const deployState = readDeployState();
  if (deployState && isDeployStateStale(deployState)) {
    const elapsedMin = Math.round((Date.now() - new Date(deployState.startedAt).getTime()) / 60000);
    console.warn(`[Deploy] Clearing stale in_progress state (${elapsedMin}m old)`);
    clearDeployState();
  } else if (deployState && deployState.status === "in_progress") {
    const verifyStartedAt = new Date().toISOString();
    const elapsedMs = Date.now() - new Date(deployState.startedAt).getTime();
    const elapsedSec = Math.round(elapsedMs / 1000);
    const currentSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

    console.info(
      `[Deploy] Resuming verification (${elapsedSec}s elapsed, SHA: ${currentSha.slice(0, 7)})`
    );

    writeDeployState({ ...deployState, status: "verifying", verifyStartedAt });

    const commitSummary = deployState.commits
      .map((c) => `  - ${c.sha.slice(0, 7)}: ${c.message} (${c.author})`)
      .join("\n");

    // Fire in background — don't block startup
    void (async () => {
      // Wait for server + scheduler to be fully ready
      await new Promise((r) => setTimeout(r, 3000));

      try {
        await runAgentLoop({
          sessionId: deployState.threadId,
          message: `Resuming after deployment restart (${elapsedSec}s elapsed since you triggered the update).

The updater has completed and the server is back online. Load the verify-update skill to check that everything is working.

Deploy details:
- Before SHA: ${deployState.beforeSha}
- Expected SHA: ${deployState.afterSha}
- Current SHA: ${currentSha}
- Commits deployed:
${commitSummary}`,
          channelName: "github",
        });

        // If we get here, the verify session completed (agent handled deploy state cleanup)
        console.info("[Deploy] Verification session completed");
      } catch (error) {
        console.error("[Deploy] Verification session error:", error);
        clearDeployState();
      }
    })();
  } else if (deployState && deployState.status === "verifying") {
    // Crashed during verification — clean up stale state
    console.warn("[Deploy] Clearing stale verifying state from previous run");
    clearDeployState();
  }

  // Initialize scheduler (creates schema + starts background loop)
  initScheduler();
  console.info("✓ Scheduler initialized");

  // Initialize task system (creates schema + cleans up old tasks)
  initTasks();
  console.info("✓ Tasks initialized");

  const app = createServer({ whatsappAdapter, channelAdapters });

  console.info(`
╔═══════════════════════════════════════╗
║          🌿 Fern v${VERSION}              ║
║   Self-improving headless AI agent    ║
╚═══════════════════════════════════════╝
`);

  console.info(`Starting server on ${config.server.host}:${config.server.port}`);
  console.info(
    `Using model: ${config.model.provider}/${config.model.model}${config.model.baseUrl ? ` (via ${config.model.baseUrl})` : ""}`
  );
  if (whatsappAdapter) {
    console.info("WhatsApp: enabled (Twilio)");
  }
  console.info("");

  serve(
    {
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    },
    (info) => {
      console.info(`✓ Server running at http://${info.address}:${info.port}`);
      console.info("");
      console.info("Endpoints:");
      console.info("  GET  /health            - Health check");
      console.info("  POST /chat              - Send a message");
      console.info("  POST /webhooks/github   - GitHub push webhook");
      if (whatsappAdapter) {
        console.info("  POST /webhooks/whatsapp - Twilio WhatsApp webhook");
      }
      console.info("");
      console.info("Test with:");
      console.info(
        `  curl http://localhost:${info.port}/chat -H "Content-Type: application/json" -d '{"message": "What time is it?"}'`
      );
    }
  );
}

main().catch(async (error) => {
  console.error("Failed to start Fern:", error);

  // Track startup failures for watchdog (persists across pm2 restarts)
  const exceeded = recordOpenCodeFailure();
  if (exceeded) {
    const msg = `Fern shutting down: startup failed after repeated attempts at ${new Date().toLocaleTimeString()}`;
    await sendAlert(msg);
  }

  process.exit(1);
});
