import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock memory dependencies before importing
vi.mock("@/memory/persistent.js", () => ({
  writeMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock("@/memory/search.js", () => ({
  searchMemory: vi.fn(),
}));

vi.mock("@/memory/storage.js", () => ({
  readChunk: vi.fn(),
}));

import { deleteMemory, writeMemory } from "@/memory/persistent.js";
import { searchMemory } from "@/memory/search.js";
import { readChunk } from "@/memory/storage.js";
import { createMemoryApi } from "@/server/memory-api.js";
import { Hono } from "hono";

const mockWriteMemory = vi.mocked(writeMemory);
const mockDeleteMemory = vi.mocked(deleteMemory);
const mockSearchMemory = vi.mocked(searchMemory);
const mockReadChunk = vi.mocked(readChunk);

describe("createMemoryApi", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mount the memory API under a prefix like the real server does
    const root = new Hono();
    root.route("/internal/memory", createMemoryApi());
    app = root;
  });

  describe("POST /internal/memory/write", () => {
    it("writes a memory with valid input", async () => {
      const mockMemory = {
        id: "mem_123",
        type: "fact" as const,
        content: "User likes TypeScript",
        tags: ["tech"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockWriteMemory.mockResolvedValue(mockMemory);

      const res = await app.request("/internal/memory/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "fact",
          content: "User likes TypeScript",
          tags: ["tech"],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("mem_123");
      expect(mockWriteMemory).toHaveBeenCalledWith({
        type: "fact",
        content: "User likes TypeScript",
        tags: ["tech"],
      });
    });

    it("defaults tags to empty array when not provided", async () => {
      mockWriteMemory.mockResolvedValue({
        id: "mem_456",
        type: "learning" as const,
        content: "test content",
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await app.request("/internal/memory/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "learning",
          content: "test content",
        }),
      });

      expect(res.status).toBe(200);
      expect(mockWriteMemory).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
    });

    it("returns 400 for invalid type", async () => {
      const res = await app.request("/internal/memory/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "invalid_type",
          content: "test",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 400 for empty content", async () => {
      const res = await app.request("/internal/memory/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "fact",
          content: "",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 400 for missing content", async () => {
      const res = await app.request("/internal/memory/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "fact",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
      expect(Array.isArray(body.details)).toBe(true);
    });

    it("accepts all valid memory types", async () => {
      const types = ["fact", "preference", "learning"] as const;

      for (const type of types) {
        mockWriteMemory.mockResolvedValue({
          id: `mem_${type}`,
          type,
          content: "test",
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        const res = await app.request("/internal/memory/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, content: "test" }),
        });

        expect(res.status).toBe(200);
      }
    });
  });

  describe("POST /internal/memory/search", () => {
    it("searches with valid query", async () => {
      mockSearchMemory.mockResolvedValue([
        {
          id: "result_1",
          source: "memory" as const,
          text: "TypeScript is great",
          relevanceScore: 0.95,
        },
      ]);

      const res = await app.request("/internal/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "TypeScript" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].text).toBe("TypeScript is great");
      expect(mockSearchMemory).toHaveBeenCalledWith("TypeScript", {
        limit: undefined,
        threadId: undefined,
      });
    });

    it("passes optional limit and threadId", async () => {
      mockSearchMemory.mockResolvedValue([]);

      const res = await app.request("/internal/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "test",
          limit: 5,
          threadId: "thread_abc",
        }),
      });

      expect(res.status).toBe(200);
      expect(mockSearchMemory).toHaveBeenCalledWith("test", {
        limit: 5,
        threadId: "thread_abc",
      });
    });

    it("returns 400 for empty query", async () => {
      const res = await app.request("/internal/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 400 for missing query", async () => {
      const res = await app.request("/internal/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
      expect(Array.isArray(body.details)).toBe(true);
    });
  });

  describe("POST /internal/memory/read", () => {
    it("reads a chunk successfully", async () => {
      const mockChunk = {
        id: "chunk_456",
        threadId: "thread_123",
        openCodeSessionId: "sess_1",
        summary: "A greeting exchange",
        messages: [
          {
            id: "msg-1",
            sessionID: "sess_1",
            role: "user" as const,
            time: { created: Date.now() },
            parts: [{ id: "p1", type: "text", text: "Hello" }],
          },
          {
            id: "msg-2",
            sessionID: "sess_1",
            role: "assistant" as const,
            time: { created: Date.now() },
            parts: [{ id: "p2", type: "text", text: "Hi!" }],
          },
        ],
        tokenCount: 100,
        messageCount: 2,
        messageRange: {
          firstMessageId: "msg-1",
          lastMessageId: "msg-2",
          firstTimestamp: Date.now(),
          lastTimestamp: Date.now(),
        },
        createdAt: new Date().toISOString(),
      };
      mockReadChunk.mockReturnValue(mockChunk);

      const res = await app.request("/internal/memory/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "thread_123",
          chunkId: "chunk_456",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(2);
      expect(mockReadChunk).toHaveBeenCalledWith("thread_123", "chunk_456");
    });

    it("returns 404 when chunk is not found", async () => {
      mockReadChunk.mockReturnValue(null);

      const res = await app.request("/internal/memory/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "thread_nonexistent",
          chunkId: "chunk_nonexistent",
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Chunk not found");
    });

    it("returns 400 for missing threadId", async () => {
      const res = await app.request("/internal/memory/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkId: "chunk_456" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
      expect(Array.isArray(body.details)).toBe(true);
    });

    it("returns 400 for missing chunkId", async () => {
      const res = await app.request("/internal/memory/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "thread_123" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
      expect(Array.isArray(body.details)).toBe(true);
    });

    it("returns 400 for empty threadId", async () => {
      const res = await app.request("/internal/memory/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "", chunkId: "chunk_456" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });
  });

  describe("DELETE /internal/memory/delete/:id", () => {
    it("deletes a memory and returns result", async () => {
      mockDeleteMemory.mockReturnValue(true);

      const res = await app.request("/internal/memory/delete/mem_123", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
      expect(mockDeleteMemory).toHaveBeenCalledWith("mem_123");
    });

    it("returns false when memory does not exist", async () => {
      mockDeleteMemory.mockReturnValue(false);

      const res = await app.request("/internal/memory/delete/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(false);
    });
  });
});
