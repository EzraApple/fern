import * as fs from "node:fs";
import * as path from "node:path";
import { findAvailablePort, getOpenCodeConfig, usedPorts } from "@/core/opencode/config.js";
import type { OpenCodeClient } from "@/core/opencode/config.js";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";

// Store server and client info (shared, single instance)
let serverInfo: {
  url: string;
  port: number;
  close: () => void;
  client: OpenCodeClient;
} | null = null;

/**
 * Ensure the OpenCode server is running and return the client
 * Retries with different ports if initial port is in use
 */
export async function ensureOpenCode(): Promise<{
  url: string;
  port: number;
  client: OpenCodeClient;
}> {
  if (serverInfo) {
    return {
      url: serverInfo.url,
      port: serverInfo.port,
      client: serverInfo.client,
    };
  }

  // Set OPENCODE_CONFIG_DIR so OpenCode auto-discovers tools
  const toolDir = path.join(process.cwd(), "src", ".opencode", "tool");
  process.env.OPENCODE_CONFIG_DIR = path.join(process.cwd(), "src", ".opencode");

  // Check if tool directory exists
  if (fs.existsSync(toolDir)) {
    try {
      const _toolFiles = fs.readdirSync(toolDir);
    } catch (err) {
      console.error("[OpenCode] Failed to read tool directory:", err);
    }
  } else {
    console.warn(`[OpenCode] Tool directory NOT FOUND at ${toolDir}`);
  }

  const config = getOpenCodeConfig();
  const MAX_RETRIES = 100;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = findAvailablePort();
    usedPorts.add(port);

    try {
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port,
        timeout: 30000,
        config,
      });

      const client = createOpencodeClient({
        baseUrl: server.url,
      });

      serverInfo = { url: server.url, port, close: server.close, client };

      // Wait for tools to be available
      const waitForTools = async (): Promise<string[]> => {
        const maxAttempts = 10;
        const delayMs = 300;
        for (let i = 1; i <= maxAttempts; i++) {
          const result = await client.tool.ids();
          const tools = result.data ?? [];
          if (tools.length > 0) {
            return tools;
          }
          if (i < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        return [];
      };

      const tools = await waitForTools();
      if (tools.length > 0) {
      } else {
        console.error("[OpenCode] NO TOOLS after 10 attempts - check tool directory");
      }

      return { url: server.url, port, client };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[OpenCode] Failed to start on port ${port}: ${lastError.message}`);
      // Port is in use, try next one
    }
  }

  throw new Error(
    `Failed to start OpenCode server after ${MAX_RETRIES} attempts: ${lastError?.message}`
  );
}

/**
 * Get or create an OpenCode client
 */
export async function getClient(): Promise<OpenCodeClient> {
  const { client } = await ensureOpenCode();
  return client;
}

/**
 * Clean up and release resources
 */
export async function cleanup(): Promise<void> {
  if (serverInfo) {
    try {
      serverInfo.close();
      usedPorts.delete(serverInfo.port);
      serverInfo = null;
    } catch (error) {
      console.warn("[OpenCode] Error closing server:", error);
    }
  }
}
