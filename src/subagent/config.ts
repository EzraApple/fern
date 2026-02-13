import type { SubagentConfig } from "@/subagent/types.js";

const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  enabled: true,
  maxConcurrentTasks: 3,
};

let cachedConfig: SubagentConfig | null = null;

export function getSubagentConfig(): SubagentConfig {
  if (cachedConfig) return cachedConfig;

  const config = { ...DEFAULT_SUBAGENT_CONFIG };

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const enabled = process.env["FERN_SUBAGENT_ENABLED"];
  if (enabled !== undefined) {
    config.enabled = enabled !== "false";
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const maxConcurrent = process.env["FERN_SUBAGENT_MAX_CONCURRENT"];
  if (maxConcurrent) {
    const parsed = Number.parseInt(maxConcurrent, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.maxConcurrentTasks = parsed;
    }
  }

  cachedConfig = config;
  return config;
}

/** Reset cached config (for testing) */
export function resetSubagentConfig(): void {
  cachedConfig = null;
}
