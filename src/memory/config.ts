import * as os from "node:os";
import * as path from "node:path";
import type { MemoryArchivalConfig } from "./types.js";

const DEFAULT_STORAGE_PATH = path.join(os.homedir(), ".fern", "memory");

const DEFAULT_MEMORY_CONFIG: MemoryArchivalConfig = {
  enabled: true,
  storagePath: DEFAULT_STORAGE_PATH,
  chunkTokenThreshold: 25_000,
  chunkTokenMin: 15_000,
  chunkTokenMax: 40_000,
  summarizationModel: "gpt-4o-mini",
  maxSummaryTokens: 1024,
  embeddingModel: "text-embedding-3-small",
  dbPath: path.join(DEFAULT_STORAGE_PATH, "fern.db"),
};

let cachedMemoryConfig: MemoryArchivalConfig | null = null;

export function getMemoryConfig(): MemoryArchivalConfig {
  if (cachedMemoryConfig) {
    return cachedMemoryConfig;
  }

  const config = { ...DEFAULT_MEMORY_CONFIG };

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const enabled = process.env["FERN_MEMORY_ENABLED"];
  if (enabled !== undefined) {
    config.enabled = enabled !== "false";
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const storagePath = process.env["FERN_MEMORY_PATH"];
  if (storagePath) {
    config.storagePath = storagePath.startsWith("~")
      ? path.join(os.homedir(), storagePath.slice(1))
      : storagePath;
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const chunkThreshold = process.env["FERN_MEMORY_CHUNK_TOKENS"];
  if (chunkThreshold) {
    const parsed = Number.parseInt(chunkThreshold, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.chunkTokenThreshold = parsed;
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const model = process.env["FERN_MEMORY_MODEL"];
  if (model) {
    config.summarizationModel = model;
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const memoryBaseUrl = process.env["FERN_MEMORY_BASE_URL"];
  if (memoryBaseUrl) {
    config.summarizationBaseUrl = memoryBaseUrl;
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const embeddingModel = process.env["FERN_MEMORY_EMBEDDING_MODEL"];
  if (embeddingModel) {
    config.embeddingModel = embeddingModel;
  }

  // Keep dbPath in sync with storagePath
  config.dbPath = path.join(config.storagePath, "fern.db");

  cachedMemoryConfig = config;
  return config;
}
