/**
 * Model configuration for all AI tasks.
 * Single source of truth - uses "provider/model" format.
 */

/**
 * Task-based model configuration
 */
export const TaskModels = {
  // Code generation, debugging, refactoring
  coding: "anthropic/claude-opus-4-5",
  // Research, search, general Q&A
  general: "anthropic/claude-opus-4-5",
  // Summarizing responses
  summarization: "google/gemini-2.0-flash",
  // Video/image description
  vision: "google/gemini-2.0-flash",
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
