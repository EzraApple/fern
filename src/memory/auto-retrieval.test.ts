import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockGetMemoryConfig = vi.fn();
const mockSearchMemory = vi.fn();

vi.mock("@/memory/config.js", () => ({
  getMemoryConfig: () => mockGetMemoryConfig(),
}));

vi.mock("@/memory/search.js", () => ({
  searchMemory: (query: string, options?: unknown) => mockSearchMemory(query, options),
}));

describe("auto-retrieval", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetMemoryConfig.mockReset();
    mockSearchMemory.mockReset();

    // Clear env vars
    process.env.FERN_AUTO_MEMORY_ENABLED = undefined;
    process.env.FERN_AUTO_MEMORY_TOP_K = undefined;
    process.env.FERN_AUTO_MEMORY_MIN_RELEVANCE = undefined;
    process.env.FERN_AUTO_MEMORY_MAX_CHARS = undefined;
    process.env.FERN_AUTO_MEMORY_THREAD_SCOPED = undefined;
  });

  describe("getAutoRetrievalConfig", () => {
    it("should return default config when no env vars set", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.enabled).toBe(true);
      expect(config.topK).toBe(3);
      expect(config.minRelevance).toBe(0.3);
      expect(config.maxContextChars).toBe(2000);
      expect(config.threadScoped).toBe(false);
    });

    it("should respect FERN_AUTO_MEMORY_ENABLED=false", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_ENABLED = "false";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.enabled).toBe(false);
    });

    it("should parse FERN_AUTO_MEMORY_TOP_K", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_TOP_K = "5";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.topK).toBe(5);
    });

    it("should cap topK at 10", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_TOP_K = "20";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.topK).toBe(10);
    });

    it("should parse FERN_AUTO_MEMORY_MIN_RELEVANCE", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_MIN_RELEVANCE = "0.5";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.minRelevance).toBe(0.5);
    });

    it("should parse FERN_AUTO_MEMORY_MAX_CHARS", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_MAX_CHARS = "3000";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.maxContextChars).toBe(3000);
    });

    it("should parse FERN_AUTO_MEMORY_THREAD_SCOPED", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_THREAD_SCOPED = "true";
      const { getAutoRetrievalConfig, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const config = getAutoRetrievalConfig();

      expect(config.threadScoped).toBe(true);
    });
  });

  describe("retrieveRelevantMemories", () => {
    it("should return null when memory system is disabled", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: false });
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("test message");

      expect(result).toBeNull();
    });

    it("should return null when auto-retrieval is disabled", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_ENABLED = "false";
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("test message");

      expect(result).toBeNull();
    });

    it("should return null for very short messages", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("ab");

      expect(result).toBeNull();
    });

    it("should search memories and return formatted results", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      mockSearchMemory.mockResolvedValue([
        {
          id: "chunk_1",
          source: "archive" as const,
          text: "User discussed coffee preferences",
          relevanceScore: 0.85,
          threadId: "whatsapp_+123",
          tokenCount: 150,
          timeRange: { start: Date.now() - 86400000, end: Date.now() - 86000000 },
        },
        {
          id: "mem_1",
          source: "memory" as const,
          text: "User prefers dark roast",
          relevanceScore: 0.92,
          memoryType: "preference" as const,
          tags: ["coffee", "preferences"],
        },
      ]);
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("What coffee should I get?", "whatsapp_+123");

      expect(result).toHaveLength(2);
      expect(result?.[0]?.text).toBe("User discussed coffee preferences");
      expect(result?.[0]?.source).toBe("archive");
      expect(result?.[1]?.text).toBe("User prefers dark roast");
      expect(result?.[1]?.memoryType).toBe("preference");
    });

    it("should filter by relevance threshold", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_MIN_RELEVANCE = "0.8";
      mockSearchMemory.mockResolvedValue([
        {
          id: "chunk_1",
          source: "archive" as const,
          text: "High relevance",
          relevanceScore: 0.85,
        },
        {
          id: "chunk_2",
          source: "archive" as const,
          text: "Low relevance",
          relevanceScore: 0.5,
        },
      ]);
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("test");

      expect(result).toHaveLength(1);
      expect(result?.[0]?.text).toBe("High relevance");
    });

    it("should respect threadScoped setting", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_THREAD_SCOPED = "true";
      mockSearchMemory.mockResolvedValue([]);
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      await retrieveRelevantMemories("test", "whatsapp_+123");

      expect(mockSearchMemory).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ threadId: "whatsapp_+123" })
      );
    });

    it("should not filter by threadId when threadScoped is false", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_THREAD_SCOPED = "false";
      mockSearchMemory.mockResolvedValue([]);
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      await retrieveRelevantMemories("test", "whatsapp_+123");

      expect(mockSearchMemory).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ threadId: undefined })
      );
    });

    it("should return null on search error", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      mockSearchMemory.mockRejectedValue(new Error("Search failed"));
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("test");

      expect(result).toBeNull();
    });

    it("should return null when no results found", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      mockSearchMemory.mockResolvedValue([]);
      const { retrieveRelevantMemories, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = await retrieveRelevantMemories("test");

      expect(result).toBeNull();
    });
  });

  describe("formatMemoriesForContext", () => {
    it("should return empty string for null memories", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");

      const result = formatMemoriesForContext(null);

      expect(result).toBe("");
    });

    it("should return empty string for empty array", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");

      const result = formatMemoriesForContext([]);

      expect(result).toBe("");
    });

    it("should format archive memories with date", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");
      const now = Date.now();

      const result = formatMemoriesForContext([
        {
          text: "Discussion about project goals",
          source: "archive",
          relevance: 0.8,
          timeRange: { start: new Date(now - 86400000), end: new Date(now - 86000000) },
        },
      ]);

      expect(result).toContain("Relevant Context from Memory");
      expect(result).toContain("[Past Conversation]");
      expect(result).toContain("Discussion about project goals");
    });

    it("should format persistent memories with type and tags", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");

      const result = formatMemoriesForContext([
        {
          text: "User likes hiking on weekends",
          source: "memory",
          relevance: 0.9,
          memoryType: "preference",
          tags: ["hobbies", "weekend"],
        },
      ]);

      expect(result).toContain("[Preference]");
      expect(result).toContain("(hobbies, weekend)");
      expect(result).toContain("User likes hiking on weekends");
    });

    it("should format fact memories correctly", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");

      const result = formatMemoriesForContext([
        {
          text: "User works at Acme Corp",
          source: "memory",
          relevance: 0.85,
          memoryType: "fact",
        },
      ]);

      expect(result).toContain("[Fact]");
      expect(result).toContain("User works at Acme Corp");
    });

    it("should respect maxContextChars limit", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      process.env.FERN_AUTO_MEMORY_MAX_CHARS = "50";
      const { formatMemoriesForContext, clearAutoRetrievalConfigCache } = await import(
        "./auto-retrieval.js"
      );
      clearAutoRetrievalConfigCache();

      const result = formatMemoriesForContext([
        { text: "First memory that is quite long and detailed", source: "memory", relevance: 0.9 },
        { text: "Second memory that should not fit", source: "memory", relevance: 0.8 },
      ]);

      expect(result.length).toBeLessThanOrEqual(50 + 100); // Allow some buffer for header
    });

    it("should format learning memories correctly", async () => {
      mockGetMemoryConfig.mockReturnValue({ enabled: true });
      const { formatMemoriesForContext } = await import("./auto-retrieval.js");

      const result = formatMemoriesForContext([
        {
          text: "Always check dependencies before committing",
          source: "memory",
          relevance: 0.88,
          memoryType: "learning",
          tags: ["workflow"],
        },
      ]);

      expect(result).toContain("[Learning]");
      expect(result).toContain("(workflow)");
    });
  });
});
