/**
 * Model configuration for all AI tasks.
 * Single source of truth - uses "provider/model" format.
 */

export const DEFAULT_OLLAMA_MODEL = "qwen3-vl:32b";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Task-based model configuration
 */
export const TaskModels = {
  coding: `ollama/${DEFAULT_OLLAMA_MODEL}`,
  general: `ollama/${DEFAULT_OLLAMA_MODEL}`,
  summarization: `ollama/${DEFAULT_OLLAMA_MODEL}`,
  vision: `ollama/${DEFAULT_OLLAMA_MODEL}`,
} as const;

export type TaskType = keyof typeof TaskModels;

/**
 * Parse a model string into provider and model ID
 */
export function parseModelString(modelString: string): { provider: string; model: string } {
  const [provider, model] = modelString.split("/");
  if (!provider || !model) {
    throw new Error(`Invalid model string: ${modelString}`);
  }
  return { provider, model };
}

/**
 * Default model for OpenCode sessions
 */
export const DEFAULT_MODEL = TaskModels.coding;
