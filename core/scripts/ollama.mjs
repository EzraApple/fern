#!/usr/bin/env node

/**
 * Ollama startup script for Jarvis
 *
 * Ensures Ollama is running and warms the model before starting the agent.
 * - Checks if Ollama server is reachable
 * - Starts `ollama serve` if not running
 * - Runs `ollama run <model>` to preload the model into memory
 */

import { spawn } from "child_process";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3-vl:32b";
const OLLAMA_HEALTH_TIMEOUT_MS = 30000;
const OLLAMA_HEALTH_POLL_MS = 500;

async function isOllamaRunning() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForOllama() {
  const start = Date.now();
  while (Date.now() - start < OLLAMA_HEALTH_TIMEOUT_MS) {
    if (await isOllamaRunning()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, OLLAMA_HEALTH_POLL_MS));
  }
  return false;
}

async function startOllamaServe() {
  console.log("[Ollama] Starting ollama serve...");

  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const ready = await waitForOllama();
  if (!ready) {
    throw new Error("Ollama server failed to start within timeout");
  }
  console.log("[Ollama] Server is running");
}

async function warmModel() {
  console.log(`[Ollama] Warming model ${OLLAMA_MODEL}...`);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: "",
        keep_alive: "10m",
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (response.ok) {
      console.log(`[Ollama] Model ${OLLAMA_MODEL} is warm`);
    } else {
      const text = await response.text();
      console.warn(`[Ollama] Warm-up response: ${response.status} - ${text}`);
    }
  } catch (error) {
    console.warn(`[Ollama] Model warm-up returned: ${error.message}`);
  }
}

async function main() {
  console.log(`[Ollama] Checking server at ${OLLAMA_BASE_URL}...`);

  const running = await isOllamaRunning();

  if (!running) {
    await startOllamaServe();
  } else {
    console.log("[Ollama] Server already running");
  }

  await warmModel();
  console.log("[Ollama] Ready");
}

main().catch((err) => {
  console.error("[Ollama] Failed to initialize:", err.message);
  process.exit(1);
});
