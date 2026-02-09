import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistentMemory, SummaryIndexEntry } from "./types.js";

// Use a fresh temp directory for each test suite run
let testDbDir: string;
let testDbPath: string;

vi.mock("./config.js", () => ({
  getMemoryConfig: () => ({
    enabled: true,
    storagePath: testDbDir,
    chunkTokenThreshold: 25_000,
    chunkTokenMin: 15_000,
    chunkTokenMax: 40_000,
    summarizationModel: "gpt-4o-mini",
    maxSummaryTokens: 1024,
    embeddingModel: "text-embedding-3-small",
    dbPath: testDbPath,
  }),
}));

// Mock embeddings to avoid actual API calls during JSONL migration
vi.mock("./embeddings.js", () => ({
  embedBatch: vi.fn().mockResolvedValue([]),
  embedText: vi.fn().mockResolvedValue([]),
}));

describe("db", () => {
  beforeEach(async () => {
    // Need to reset module state for each test
    vi.resetModules();

    testDbDir = path.join(
      os.tmpdir(),
      `fern-test-db-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    testDbPath = path.join(testDbDir, "fern.db");
    fs.mkdirSync(testDbDir, { recursive: true });

    // Re-import after resetting modules
    const dbMod = await import("./db.js");
    await dbMod.initMemoryDb();
  });

  afterEach(async () => {
    const dbMod = await import("./db.js");
    dbMod.closeDb();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe("vectorToBlob", () => {
    it("converts float array to Buffer", async () => {
      const dbMod = await import("./db.js");
      const blob = dbMod.vectorToBlob([1.0, 2.0, 3.0]);
      expect(blob).toBeInstanceOf(Buffer);
      // Float32Array has 4 bytes per element
      expect(blob.length).toBe(12);
    });

    it("round-trips through Float32Array", async () => {
      const dbMod = await import("./db.js");
      const input = [0.5, 1.5, -2.5];
      const blob = dbMod.vectorToBlob(input);
      const output = new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4);
      expect(Array.from(output)).toEqual(input.map((n) => Math.fround(n)));
    });
  });

  describe("initMemoryDb / getDb / closeDb", () => {
    it("creates database file", async () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    it("getDb returns a database instance", async () => {
      const dbMod = await import("./db.js");
      const db = dbMod.getDb();
      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe("function");
    });

    it("creates summaries table", async () => {
      const dbMod = await import("./db.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='summaries'")
        .all();
      expect(tables.length).toBe(1);
    });

    it("creates memories table", async () => {
      const dbMod = await import("./db.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
        .all();
      expect(tables.length).toBe(1);
    });

    it("creates FTS5 tables", async () => {
      const dbMod = await import("./db.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('summaries_fts', 'memories_fts')"
        )
        .all();
      expect(tables.length).toBe(2);
    });

    it("closeDb allows re-init", async () => {
      const dbMod = await import("./db.js");
      dbMod.closeDb();
      await dbMod.initMemoryDb();
      const db = dbMod.getDb();
      expect(db).toBeDefined();
    });

    it("isVectorReady returns a boolean", async () => {
      const dbMod = await import("./db.js");
      // May or may not be true depending on sqlite-vec availability
      expect(typeof dbMod.isVectorReady()).toBe("boolean");
    });

    it("closeDb resets vectorReady to false", async () => {
      const dbMod = await import("./db.js");
      // vectorReady may be true or false depending on sqlite-vec, but after close it must be false
      dbMod.closeDb();
      expect(dbMod.isVectorReady()).toBe(false);
    });

    it("initMemoryDb is idempotent (second call is a no-op)", async () => {
      const dbMod = await import("./db.js");
      // First init already happened in beforeEach; second should not throw
      await dbMod.initMemoryDb();
      const db = dbMod.getDb();
      expect(db).toBeDefined();
    });
  });

  describe("insertSummary", () => {
    it("inserts a summary into the database", async () => {
      const dbMod = await import("./db.js");
      const entry: SummaryIndexEntry = {
        chunkId: "chunk_001",
        threadId: "thread-1",
        summary: "Test summary content",
        tokenCount: 500,
        createdAt: "2024-01-01T00:00:00.000Z",
        timeRange: { start: 1000, end: 2000 },
      };

      dbMod.insertSummary(entry, []);

      const db = dbMod.getDb();
      const row = db.prepare("SELECT * FROM summaries WHERE id = ?").get("chunk_001") as {
        id: string;
        summary: string;
        thread_id: string;
        token_count: number;
      };
      expect(row).toBeDefined();
      expect(row.summary).toBe("Test summary content");
      expect(row.thread_id).toBe("thread-1");
      expect(row.token_count).toBe(500);
    });

    it("inserts into FTS5 table", async () => {
      const dbMod = await import("./db.js");
      const entry: SummaryIndexEntry = {
        chunkId: "chunk_002",
        threadId: "thread-1",
        summary: "Searchable summary text",
        tokenCount: 100,
        createdAt: "2024-01-01T00:00:00.000Z",
        timeRange: { start: 1000, end: 2000 },
      };

      dbMod.insertSummary(entry, []);

      const db = dbMod.getDb();
      const rows = db
        .prepare("SELECT * FROM summaries_fts WHERE summaries_fts MATCH ?")
        .all('"Searchable"');
      expect(rows.length).toBe(1);
    });

    it("replaces existing summary on conflict", async () => {
      const dbMod = await import("./db.js");
      const entry: SummaryIndexEntry = {
        chunkId: "chunk_003",
        threadId: "thread-1",
        summary: "Original summary",
        tokenCount: 100,
        createdAt: "2024-01-01T00:00:00.000Z",
        timeRange: { start: 1000, end: 2000 },
      };

      dbMod.insertSummary(entry, []);
      dbMod.insertSummary({ ...entry, summary: "Updated summary" }, []);

      const db = dbMod.getDb();
      const row = db.prepare("SELECT summary FROM summaries WHERE id = ?").get("chunk_003") as {
        summary: string;
      };
      expect(row.summary).toBe("Updated summary");
    });
  });

  describe("insertMemory / getMemoryById / deleteMemory / listMemories", () => {
    const testMemory: PersistentMemory = {
      id: "mem_001",
      type: "fact",
      content: "The user's name is Alice",
      tags: ["user", "name"],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    it("inserts and retrieves a memory", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);

      const result = dbMod.getMemoryById("mem_001");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("mem_001");
      expect(result?.type).toBe("fact");
      expect(result?.content).toBe("The user's name is Alice");
      expect(result?.tags).toEqual(["user", "name"]);
    });

    it("returns null for non-existent memory", async () => {
      const dbMod = await import("./db.js");
      expect(dbMod.getMemoryById("nonexistent")).toBeNull();
    });

    it("deletes a memory", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);

      const deleted = dbMod.deleteMemory("mem_001");
      expect(deleted).toBe(true);
      expect(dbMod.getMemoryById("mem_001")).toBeNull();
    });

    it("returns false when deleting non-existent memory", async () => {
      const dbMod = await import("./db.js");
      expect(dbMod.deleteMemory("nonexistent")).toBe(false);
    });

    it("lists all memories", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);
      dbMod.insertMemory(
        {
          ...testMemory,
          id: "mem_002",
          type: "preference",
          content: "Prefers dark mode",
          createdAt: "2024-01-02T00:00:00.000Z",
        },
        []
      );

      const all = dbMod.listMemories();
      expect(all.length).toBe(2);
    });

    it("lists memories filtered by type", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);
      dbMod.insertMemory(
        {
          ...testMemory,
          id: "mem_002",
          type: "preference",
          content: "Prefers dark mode",
        },
        []
      );

      const facts = dbMod.listMemories({ type: "fact" });
      expect(facts.length).toBe(1);
      expect(facts[0]!.type).toBe("fact");
    });

    it("respects limit parameter", async () => {
      const dbMod = await import("./db.js");
      for (let i = 0; i < 5; i++) {
        dbMod.insertMemory(
          {
            ...testMemory,
            id: `mem_${i}`,
            createdAt: `2024-01-0${i + 1}T00:00:00.000Z`,
          },
          []
        );
      }

      const limited = dbMod.listMemories({ limit: 3 });
      expect(limited.length).toBe(3);
    });

    it("lists memories ordered by created_at DESC", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(
        { ...testMemory, id: "mem_old", createdAt: "2024-01-01T00:00:00.000Z" },
        []
      );
      dbMod.insertMemory(
        { ...testMemory, id: "mem_new", createdAt: "2024-01-05T00:00:00.000Z" },
        []
      );

      const all = dbMod.listMemories();
      expect(all[0]!.id).toBe("mem_new");
      expect(all[1]!.id).toBe("mem_old");
    });

    it("inserts into FTS5 table for keyword search", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);

      const db = dbMod.getDb();
      const rows = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH ?")
        .all('"Alice"');
      expect(rows.length).toBe(1);
    });

    it("deletes from FTS5 table", async () => {
      const dbMod = await import("./db.js");
      dbMod.insertMemory(testMemory, []);
      dbMod.deleteMemory("mem_001");

      const db = dbMod.getDb();
      const rows = db
        .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH ?")
        .all('"Alice"');
      expect(rows.length).toBe(0);
    });
  });
});
