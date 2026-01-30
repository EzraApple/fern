import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "@/config/index.js";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL } from "@/constants/models.js";

const execAsync = promisify(exec);

function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
}

function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL.replace("/v1", "");
}

/**
 * Unload the Ollama model from memory.
 * Called on shutdown to free VRAM.
 */
export async function unloadOllamaModel(): Promise<void> {
  const model = getOllamaModel();
  logger.info(`[Ollama] Unloading model ${model}...`);

  try {
    const baseUrl = getOllamaBaseUrl();
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      logger.info(`[Ollama] Model ${model} unloaded`);
    } else {
      logger.warn(`[Ollama] Unload request returned ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[Ollama] Failed to unload model: ${message}`);
  }
}

/**
 * Check if Ollama server is reachable.
 */
export async function isOllamaHealthy(): Promise<boolean> {
  try {
    const baseUrl = getOllamaBaseUrl();
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
