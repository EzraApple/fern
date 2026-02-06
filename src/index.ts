/**
 * Fern - Self-improving headless AI agent
 *
 * Entry point for the Fern agent runtime.
 */

import { serve } from "@hono/node-server";
import { WhatsAppAdapter } from "./channels/index.js";
import { getTwilioCredentials, loadConfig } from "./config/index.js";
import { loadBasePrompt } from "./core/index.js";
import { createServer } from "./server/index.js";

export const VERSION = "0.2.0";

async function main() {
  const config = loadConfig();

  // Pre-load and cache the system prompt
  loadBasePrompt();

  // Initialize channel adapters
  let whatsappAdapter: WhatsAppAdapter | undefined;

  const twilioCreds = getTwilioCredentials();
  if (twilioCreds) {
    whatsappAdapter = new WhatsAppAdapter(twilioCreds);
    await whatsappAdapter.init();
  }

  const app = createServer({ whatsappAdapter });

  console.info(`
╔═══════════════════════════════════════╗
║          🌿 Fern v${VERSION}              ║
║   Self-improving headless AI agent    ║
╚═══════════════════════════════════════╝
`);

  console.info(`Starting server on ${config.server.host}:${config.server.port}`);
  console.info(`Using model: ${config.model.provider}/${config.model.model}`);
  console.info(`Session storage: ${config.storage.path}`);
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
