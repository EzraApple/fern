import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use a fresh temp directory for each test run
let testDbDir: string;
let testDbPath: string;

vi.mock("@/memory/config.js", () => ({
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

// Mock embeddings to avoid actual API calls
vi.mock("@/memory/embeddings.js", () => ({
  embedText: vi.fn().mockResolvedValue([]),
  embedBatch: vi.fn().mockResolvedValue([]),
}));

import type { PersistentMemory, SummaryIndexEntry } from "@/memory/types.js";

describe("search", () => {
  beforeEach(async () => {
    vi.resetModules();
    testDbDir = path.join(
      os.tmpdir(),
      `fern-test-search-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    testDbPath = path.join(testDbDir, "fern.db");
    fs.mkdirSync(testDbDir, { recursive: true });

    // Initialize DB
    const dbMod = await import("./db/index.js");
    await dbMod.initMemoryDb();
  });

  afterEach(async () => {
    const dbMod = await import("./db/index.js");
    dbMod.closeDb();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe("searchMemory (FTS-only mode)", () => {
    it("returns empty results for empty query", async () => {
      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("");
      expect(results).toEqual([]);
    });

    it("returns empty results when no data exists", async () => {
      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("test query");
      expect(results).toEqual([]);
    });

    it("finds summaries via FTS5 keyword search", async () => {
      const dbMod = await import("./db/index.js");
      const entry: SummaryIndexEntry = {
        chunkId: "chunk_001",
        threadId: "thread-1",
        summary: "The user discussed TypeScript configuration and module resolution",
        tokenCount: 500,
        createdAt: "2024-01-01T00:00:00.000Z",
        timeRange: { start: 1000, end: 2000 },
      };
      dbMod.insertSummary(entry, []);

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("TypeScript configuration");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.source).toBe("archive");
      expect(results[0]?.text).toContain("TypeScript");
      expect(results[0]?.id).toBe("chunk_001");
    });

    it("finds persistent memories via FTS5 keyword search", async () => {
      const dbMod = await import("./db/index.js");
      const memory: PersistentMemory = {
        id: "mem_001",
        type: "fact",
        content: "The user prefers dark mode themes",
        tags: ["preference", "ui"],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      dbMod.insertMemory(memory, []);

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("dark mode");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.source).toBe("memory");
      expect(results[0]?.text).toContain("dark mode");
      expect(results[0]?.memoryType).toBe("fact");
    });

    it("returns results with relevance scores", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertMemory(
        {
          id: "mem_001",
          type: "fact",
          content: "TypeScript is great for large projects",
          tags: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("TypeScript");

      expect(results.length).toBe(1);
      expect(results[0]?.relevanceScore).toBeGreaterThan(0);
    });

    it("respects limit parameter", async () => {
      const dbMod = await import("./db/index.js");
      for (let i = 0; i < 10; i++) {
        dbMod.insertMemory(
          {
            id: `mem_${i}`,
            type: "fact",
            content: `Important fact number ${i} about programming`,
            tags: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          []
        );
      }

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("programming", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("filters summaries by threadId", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertSummary(
        {
          chunkId: "chunk_a",
          threadId: "thread-1",
          summary: "Discussion about Python syntax",
          tokenCount: 100,
          createdAt: "2024-01-01T00:00:00.000Z",
          timeRange: { start: 1000, end: 2000 },
        },
        []
      );
      dbMod.insertSummary(
        {
          chunkId: "chunk_b",
          threadId: "thread-2",
          summary: "Discussion about Python packages",
          tokenCount: 100,
          createdAt: "2024-01-01T00:00:00.000Z",
          timeRange: { start: 3000, end: 4000 },
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("Python", { threadId: "thread-1" });

      const threadIds = results.map((r) => r.threadId);
      for (const tid of threadIds) {
        if (tid !== undefined) {
          expect(tid).toBe("thread-1");
        }
      }
    });

    it("sorts results by descending relevance score", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertMemory(
        {
          id: "mem_a",
          type: "fact",
          content: "Apples are red fruits",
          tags: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        []
      );
      dbMod.insertSummary(
        {
          chunkId: "chunk_a",
          threadId: "thread-1",
          summary: "Apples are red fruits that grow on trees",
          tokenCount: 50,
          createdAt: "2024-01-01T00:00:00.000Z",
          timeRange: { start: 1000, end: 2000 },
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("Apples");

      for (let i = 1; i < results.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: index is within bounds from loop
        expect(results[i - 1]!.relevanceScore).toBeGreaterThanOrEqual(results[i]!.relevanceScore);
      }
    });

    it("filters out results below minScore", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertMemory(
        {
          id: "mem_001",
          type: "fact",
          content: "Some content about bananas",
          tags: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("bananas", { minScore: 0.99 });
      // FTS-only scores are weighted by TEXT_WEIGHT=0.3, so should be below 0.99
      expect(results.length).toBe(0);
    });

    it("returns timeRange for archive results", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertSummary(
        {
          chunkId: "chunk_time",
          threadId: "thread-1",
          summary: "Testing temporal metadata",
          tokenCount: 100,
          createdAt: "2024-01-01T00:00:00.000Z",
          timeRange: { start: 5000, end: 6000 },
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("temporal metadata");

      const archiveResult = results.find((r) => r.source === "archive");
      expect(archiveResult).toBeDefined();
      expect(archiveResult?.timeRange).toEqual({ start: 5000, end: 6000 });
    });

    it("returns tags for memory results", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertMemory(
        {
          id: "mem_tagged",
          type: "preference",
          content: "User prefers verbose output",
          tags: ["ui", "output"],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("verbose output");

      const memResult = results.find((r) => r.source === "memory");
      expect(memResult).toBeDefined();
      expect(memResult?.tags).toEqual(["ui", "output"]);
    });

    it("boosts newer memories over older ones with identical content", async () => {
      const dbMod = await import("./db/index.js");
      const now = new Date();
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      dbMod.insertMemory(
        {
          id: "mem_old",
          type: "fact",
          content: "The deployment pipeline uses GitHub Actions",
          tags: [],
          createdAt: threeMonthsAgo.toISOString(),
          updatedAt: threeMonthsAgo.toISOString(),
        },
        []
      );
      dbMod.insertMemory(
        {
          id: "mem_new",
          type: "fact",
          content: "The deployment pipeline uses GitHub Actions",
          tags: [],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("deployment pipeline GitHub Actions");

      expect(results.length).toBe(2);
      // Newer memory should rank first due to recency boost
      expect(results[0]?.id).toBe("mem_new");
      expect(results[1]?.id).toBe("mem_old");
      // biome-ignore lint/style/noNonNullAssertion: index is within bounds from length check above
      expect(results[0]!.relevanceScore).toBeGreaterThan(results[1]!.relevanceScore);
    });

    it("handles queries with special characters gracefully", async () => {
      const searchMod = await import("./search.js");
      // Should not throw on special chars
      const results = await searchMod.searchMemory("@#$%^&*()");
      expect(results).toEqual([]);
    });

    it("returns default limit of 5 when no limit specified", async () => {
      const dbMod = await import("./db/index.js");
      for (let i = 0; i < 10; i++) {
        dbMod.insertMemory(
          {
            id: `mem_${i}`,
            type: "fact",
            content: `Interesting detail number ${i} about software`,
            tags: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          []
        );
      }

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("software");
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("returns default minScore of 0.05", async () => {
      const dbMod = await import("./db/index.js");
      dbMod.insertMemory(
        {
          id: "mem_score",
          type: "fact",
          content: "Extremely relevant content about zebras",
          tags: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        []
      );

      const searchMod = await import("./search.js");
      const results = await searchMod.searchMemory("zebras");
      // All returned results should be above the default minScore of 0.05
      for (const r of results) {
        expect(r.relevanceScore).toBeGreaterThanOrEqual(0.05);
      }
    });
  });
});
