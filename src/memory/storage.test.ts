import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ArchiveChunk, ArchiveWatermark } from "@/memory/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config to use a temp directory
const testStoragePath = path.join(os.tmpdir(), `fern-test-storage-${Date.now()}`);

vi.mock("@/memory/config.js", () => ({
  getMemoryConfig: () => ({
    enabled: true,
    storagePath: testStoragePath,
    chunkTokenThreshold: 25_000,
    chunkTokenMin: 15_000,
    chunkTokenMax: 40_000,
    summarizationModel: "gpt-4o-mini",
    maxSummaryTokens: 1024,
    embeddingModel: "text-embedding-3-small",
    dbPath: path.join(testStoragePath, "fern.db"),
  }),
}));

import {
  ensureStorageDirectories,
  readChunk,
  readWatermark,
  writeChunk,
  writeWatermark,
} from "@/memory/storage.js";

describe("storage", () => {
  beforeEach(() => {
    fs.mkdirSync(testStoragePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testStoragePath, { recursive: true, force: true });
  });

  describe("ensureStorageDirectories", () => {
    it("creates archives and chunks directories for a thread", () => {
      ensureStorageDirectories("thread-1");
      const chunksDir = path.join(testStoragePath, "archives", "thread-1", "chunks");
      expect(fs.existsSync(chunksDir)).toBe(true);
    });

    it("is idempotent", () => {
      ensureStorageDirectories("thread-1");
      ensureStorageDirectories("thread-1");
      const chunksDir = path.join(testStoragePath, "archives", "thread-1", "chunks");
      expect(fs.existsSync(chunksDir)).toBe(true);
    });
  });

  describe("readWatermark / writeWatermark", () => {
    const watermark: ArchiveWatermark = {
      lastArchivedMessageIndex: 5,
      lastArchivedMessageId: "msg-5",
      totalArchivedTokens: 10000,
      totalChunks: 2,
      lastArchivedAt: "2024-01-01T00:00:00.000Z",
    };

    it("returns null when no watermark exists", () => {
      expect(readWatermark("nonexistent-thread")).toBeNull();
    });

    it("writes and reads a watermark", () => {
      ensureStorageDirectories("thread-1");
      writeWatermark("thread-1", watermark);
      const result = readWatermark("thread-1");
      expect(result).toEqual(watermark);
    });

    it("overwrites existing watermark", () => {
      ensureStorageDirectories("thread-1");
      writeWatermark("thread-1", watermark);
      const updated: ArchiveWatermark = {
        ...watermark,
        lastArchivedMessageIndex: 10,
        totalChunks: 3,
      };
      writeWatermark("thread-1", updated);
      const result = readWatermark("thread-1");
      expect(result).toEqual(updated);
    });
  });

  describe("writeChunk / readChunk", () => {
    const chunk: ArchiveChunk = {
      id: "chunk_abc123",
      threadId: "thread-1",
      openCodeSessionId: "sess-1",
      summary: "Test summary",
      messages: [
        {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1000 },
          parts: [{ id: "p1", type: "text", text: "hello" }],
        },
      ],
      tokenCount: 100,
      messageCount: 1,
      messageRange: {
        firstMessageId: "msg-1",
        lastMessageId: "msg-1",
        firstTimestamp: 1000,
        lastTimestamp: 1000,
      },
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    it("returns null when chunk does not exist", () => {
      ensureStorageDirectories("thread-1");
      expect(readChunk("thread-1", "nonexistent")).toBeNull();
    });

    it("writes and reads a chunk", () => {
      writeChunk(chunk);
      const result = readChunk("thread-1", "chunk_abc123");
      expect(result).toEqual(chunk);
    });

    it("creates directories when writing a chunk", () => {
      writeChunk(chunk);
      const chunksDir = path.join(testStoragePath, "archives", "thread-1", "chunks");
      expect(fs.existsSync(chunksDir)).toBe(true);
    });

    it("chunk file is valid JSON", () => {
      writeChunk(chunk);
      const chunkPath = path.join(
        testStoragePath,
        "archives",
        "thread-1",
        "chunks",
        "chunk_abc123.json"
      );
      const content = fs.readFileSync(chunkPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.id).toBe("chunk_abc123");
    });

    it("overwrites existing chunk with same ID", () => {
      writeChunk(chunk);
      const updated = { ...chunk, summary: "Updated summary" };
      writeChunk(updated);
      const result = readChunk("thread-1", "chunk_abc123");
      expect(result?.summary).toBe("Updated summary");
    });
  });
});
