import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryConfig } from "./config.js";

const ENV_KEYS = [
  "FERN_MEMORY_ENABLED",
  "FERN_MEMORY_PATH",
  "FERN_MEMORY_CHUNK_TOKENS",
  "FERN_MEMORY_MODEL",
  "FERN_MEMORY_EMBEDDING_MODEL",
] as const;

describe("getMemoryConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    // Save and clear env vars
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const key of ENV_KEYS) {
      const original = savedEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  async function getFreshConfig() {
    const mod = await import("./config.js");
    return mod.getMemoryConfig();
  }

  it("returns default config when no env vars are set", async () => {
    const config = await getFreshConfig();
    expect(config.enabled).toBe(true);
    expect(config.storagePath).toBe(path.join(os.homedir(), ".fern", "memory"));
    expect(config.chunkTokenThreshold).toBe(25_000);
    expect(config.chunkTokenMin).toBe(15_000);
    expect(config.chunkTokenMax).toBe(40_000);
    expect(config.summarizationModel).toBe("gpt-4o-mini");
    expect(config.maxSummaryTokens).toBe(1024);
    expect(config.embeddingModel).toBe("text-embedding-3-small");
    expect(config.dbPath).toBe(path.join(os.homedir(), ".fern", "memory", "fern.db"));
  });

  it("disables memory when FERN_MEMORY_ENABLED=false", async () => {
    process.env.FERN_MEMORY_ENABLED = "false";
    const config = await getFreshConfig();
    expect(config.enabled).toBe(false);
  });

  it("enables memory for any value other than 'false'", async () => {
    process.env.FERN_MEMORY_ENABLED = "true";
    const config = await getFreshConfig();
    expect(config.enabled).toBe(true);
  });

  it("overrides storage path from env", async () => {
    process.env.FERN_MEMORY_PATH = "/tmp/test-memory";
    const config = await getFreshConfig();
    expect(config.storagePath).toBe("/tmp/test-memory");
    expect(config.dbPath).toBe(path.join("/tmp/test-memory", "fern.db"));
  });

  it("expands tilde in storage path", async () => {
    process.env.FERN_MEMORY_PATH = "~/custom-memory";
    const config = await getFreshConfig();
    expect(config.storagePath).toBe(path.join(os.homedir(), "custom-memory"));
  });

  it("overrides chunk threshold from env", async () => {
    process.env.FERN_MEMORY_CHUNK_TOKENS = "50000";
    const config = await getFreshConfig();
    expect(config.chunkTokenThreshold).toBe(50000);
  });

  it("ignores invalid chunk threshold", async () => {
    process.env.FERN_MEMORY_CHUNK_TOKENS = "not-a-number";
    const config = await getFreshConfig();
    expect(config.chunkTokenThreshold).toBe(25_000);
  });

  it("ignores negative chunk threshold", async () => {
    process.env.FERN_MEMORY_CHUNK_TOKENS = "-100";
    const config = await getFreshConfig();
    expect(config.chunkTokenThreshold).toBe(25_000);
  });

  it("ignores zero chunk threshold", async () => {
    process.env.FERN_MEMORY_CHUNK_TOKENS = "0";
    const config = await getFreshConfig();
    expect(config.chunkTokenThreshold).toBe(25_000);
  });

  it("keeps dbPath in sync with overridden storagePath", async () => {
    process.env.FERN_MEMORY_PATH = "/custom/path";
    const config = await getFreshConfig();
    expect(config.dbPath).toBe("/custom/path/fern.db");
  });

  it("enables memory for empty string FERN_MEMORY_ENABLED", async () => {
    process.env.FERN_MEMORY_ENABLED = "";
    const config = await getFreshConfig();
    expect(config.enabled).toBe(true);
  });

  it("overrides summarization model from env", async () => {
    process.env.FERN_MEMORY_MODEL = "gpt-4o";
    const config = await getFreshConfig();
    expect(config.summarizationModel).toBe("gpt-4o");
  });

  it("overrides embedding model from env", async () => {
    process.env.FERN_MEMORY_EMBEDDING_MODEL = "text-embedding-3-large";
    const config = await getFreshConfig();
    expect(config.embeddingModel).toBe("text-embedding-3-large");
  });

  it("caches config on second call (using non-fresh import)", () => {
    const config1 = getMemoryConfig();
    const config2 = getMemoryConfig();
    expect(config1).toBe(config2);
  });
});
