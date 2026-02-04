/**
 * Fern - Self-improving headless AI agent
 *
 * Entry point for the Fern agent runtime.
 */

import { serve } from "@hono/node-server";
import { loadConfig } from "./config/index.js";
import { createServer } from "./server/index.js";

export const VERSION = "0.1.0";

async function main() {
	const config = loadConfig();
	const app = createServer();

	console.log(`
╔═══════════════════════════════════════╗
║          🌿 Fern v${VERSION}              ║
║   Self-improving headless AI agent    ║
╚═══════════════════════════════════════╝
`);

	console.log(`Starting server on ${config.server.host}:${config.server.port}`);
	console.log(`Using model: ${config.model.provider}/${config.model.model}`);
	console.log(`Session storage: ${config.storage.path}`);
	console.log("");

	serve(
		{
			fetch: app.fetch,
			port: config.server.port,
			hostname: config.server.host,
		},
		(info) => {
			console.log(`✓ Server running at http://${info.address}:${info.port}`);
			console.log("");
			console.log("Endpoints:");
			console.log(`  GET  /health - Health check`);
			console.log(`  POST /chat   - Send a message`);
			console.log("");
			console.log("Test with:");
			console.log(
				`  curl http://localhost:${info.port}/chat -H "Content-Type: application/json" -d '{"message": "What time is it?"}'`,
			);
		},
	);
}

main().catch((error) => {
	console.error("Failed to start Fern:", error);
	process.exit(1);
});
