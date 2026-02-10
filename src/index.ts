/**
 * Fern - Self-improving headless AI agent
 *
 * Entry point for the Fern agent runtime.
 */

import { execSync } from "node:child_process";
import { serve } from "@hono/node-server";
import { WhatsAppAdapter } from "./channels/index.js";
import type { ChannelAdapter } from "./channels/types.js";
import { getTwilioCredentials, loadConfig } from "./config/index.js";
import { loadBasePrompt } from "./core/index.js";
import * as opencodeService from "./core/opencode-service.js";
import * as workspace from "./core/workspace.js";
import { closeDb, initMemoryDb } from "./memory/index.js";
import { initScheduler, stopScheduler } from "./scheduler/index.js";
import { createServer } from "./server/index.js";

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

  // Initialize OpenCode server
  console.info("Initializing OpenCode server...");
  const opencode = await opencodeService.ensureOpenCode();
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

  // Initialize scheduler (creates schema + starts background loop)
  initScheduler();
  console.info("✓ Scheduler initialized");

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

  // Setup cleanup handlers
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
    await opencodeService.cleanup();
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

main().catch((error) => {
  console.error("Failed to start Fern:", error);
  process.exit(1);
});
