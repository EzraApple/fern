import { Config, ConfigSchema } from "@/types/index.js";

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): Config {
  const rawConfig = {
    opencode: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
    },
    github: {
      token: process.env.GITHUB_TOKEN,
      appId: process.env.GITHUB_APP_ID,
      appPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      appInstallationId: process.env.GITHUB_APP_INSTALLATION_ID,
    },
    webhook: {
      port: parseInt(process.env.WEBHOOK_PORT ?? "7829", 10),
    },
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  return result.data;
}

/**
 * Singleton config instance
 */
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config (useful for testing)
 */
function resetConfig(): void {
  configInstance = null;
}

/**
 * Simple logger implementation
 */
export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },
};

/**
 * Log current memory usage for monitoring
 */
export function logMemoryUsage(context: string): void {
  const used = process.memoryUsage();
  logger.info(`[Memory] ${context}: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}/${Math.round(used.heapTotal / 1024 / 1024)}MB, External=${Math.round(used.external / 1024 / 1024)}MB`);
}

/**
 * Attempt to trigger garbage collection if available
 */
export function tryGarbageCollect(): void {
  if (global.gc) {
    global.gc();
    logger.debug("[Memory] Forced garbage collection");
  }
}
