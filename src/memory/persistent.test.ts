import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock db functions
const mockInsertMemory = vi.fn();
const mockDbDeleteMemory = vi.fn();
const mockGetMemoryById = vi.fn();
const mockDbListMemories = vi.fn();

vi.mock("@/memory/db/memories.js", () => ({
  insertMemory: (...args: unknown[]) => mockInsertMemory(...args),
  deleteMemory: (...args: unknown[]) => mockDbDeleteMemory(...args),
  getMemoryById: (...args: unknown[]) => mockGetMemoryById(...args),
  listMemories: (...args: unknown[]) => mockDbListMemories(...args),
}));

// Mock embeddings
const mockEmbedText = vi.fn();
vi.mock("@/memory/embeddings.js", () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

// Mock ulid for deterministic IDs
vi.mock("ulid", () => ({
  ulid: () => "01ABCDEF",
}));

import { deleteMemory, getMemory, listMemories, writeMemory } from "@/memory/persistent.js";
import type { PersistentMemory } from "@/memory/types.js";

describe("persistent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("writeMemory", () => {
    it("creates a memory with generated ID and timestamps", async () => {
      mockEmbedText.mockResolvedValueOnce([0.1, 0.2, 0.3]);

      const result = await writeMemory({
        type: "fact",
        content: "The user's name is Alice",
        tags: ["user"],
      });

      expect(result.id).toBe("mem_01ABCDEF");
      expect(result.type).toBe("fact");
      expect(result.content).toBe("The user's name is Alice");
      expect(result.tags).toEqual(["user"]);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBe(result.createdAt);
    });

    it("embeds the content text", async () => {
      mockEmbedText.mockResolvedValueOnce([0.5]);

      await writeMemory({
        type: "learning",
        content: "Test content",
        tags: [],
      });

      expect(mockEmbedText).toHaveBeenCalledWith("Test content");
    });

    it("inserts memory and embedding into DB", async () => {
      const embedding = [0.1, 0.2, 0.3];
      mockEmbedText.mockResolvedValueOnce(embedding);

      await writeMemory({
        type: "preference",
        content: "Dark mode",
        tags: ["ui"],
      });

      expect(mockInsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "mem_01ABCDEF",
          type: "preference",
          content: "Dark mode",
          tags: ["ui"],
        }),
        embedding
      );
    });

    it("propagates embedding errors to caller", async () => {
      mockEmbedText.mockRejectedValueOnce(new Error("API quota exceeded"));

      await expect(
        writeMemory({
          type: "fact",
          content: "Test",
          tags: [],
        })
      ).rejects.toThrow("API quota exceeded");
    });

    it("sets createdAt and updatedAt to the same timestamp", async () => {
      mockEmbedText.mockResolvedValueOnce([]);

      const result = await writeMemory({
        type: "learning",
        content: "Something new",
        tags: ["test"],
      });

      expect(result.createdAt).toBe(result.updatedAt);
      // Verify it's a valid ISO timestamp
      expect(Number.isNaN(new Date(result.createdAt).getTime())).toBe(false);
    });
  });

  describe("deleteMemory", () => {
    it("delegates to db deleteMemory", () => {
      mockDbDeleteMemory.mockReturnValueOnce(true);
      const result = deleteMemory("mem_123");
      expect(mockDbDeleteMemory).toHaveBeenCalledWith("mem_123");
      expect(result).toBe(true);
    });

    it("returns false when memory does not exist", () => {
      mockDbDeleteMemory.mockReturnValueOnce(false);
      const result = deleteMemory("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("getMemory", () => {
    it("returns memory from db", () => {
      const mem: PersistentMemory = {
        id: "mem_123",
        type: "fact",
        content: "Test",
        tags: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      mockGetMemoryById.mockReturnValueOnce(mem);

      const result = getMemory("mem_123");
      expect(result).toEqual(mem);
      expect(mockGetMemoryById).toHaveBeenCalledWith("mem_123");
    });

    it("returns null when not found", () => {
      mockGetMemoryById.mockReturnValueOnce(null);
      expect(getMemory("nonexistent")).toBeNull();
    });
  });

  describe("listMemories", () => {
    it("delegates to db listMemories with no options", () => {
      mockDbListMemories.mockReturnValueOnce([]);
      listMemories();
      expect(mockDbListMemories).toHaveBeenCalledWith(undefined);
    });

    it("passes type filter through", () => {
      mockDbListMemories.mockReturnValueOnce([]);
      listMemories({ type: "fact" });
      expect(mockDbListMemories).toHaveBeenCalledWith({ type: "fact" });
    });

    it("passes limit through", () => {
      mockDbListMemories.mockReturnValueOnce([]);
      listMemories({ limit: 10 });
      expect(mockDbListMemories).toHaveBeenCalledWith({ limit: 10 });
    });
  });
});
