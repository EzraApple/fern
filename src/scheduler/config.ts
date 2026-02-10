import type { SchedulerConfig } from "./types.js";

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  pollIntervalMs: 60_000,
  maxConcurrentJobs: 3,
};

let cachedConfig: SchedulerConfig | null = null;

export function getSchedulerConfig(): SchedulerConfig {
  if (cachedConfig) return cachedConfig;

  const config = { ...DEFAULT_SCHEDULER_CONFIG };

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const enabled = process.env["FERN_SCHEDULER_ENABLED"];
  if (enabled !== undefined) {
    config.enabled = enabled !== "false";
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const pollInterval = process.env["FERN_SCHEDULER_POLL_INTERVAL_MS"];
  if (pollInterval) {
    const parsed = Number.parseInt(pollInterval, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.pollIntervalMs = parsed;
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const maxConcurrent = process.env["FERN_SCHEDULER_MAX_CONCURRENT"];
  if (maxConcurrent) {
    const parsed = Number.parseInt(maxConcurrent, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.maxConcurrentJobs = parsed;
    }
  }

  cachedConfig = config;
  return config;
}

/** Reset cached config (for testing) */
export function resetSchedulerConfig(): void {
  cachedConfig = null;
}
