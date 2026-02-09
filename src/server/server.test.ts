import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing server
vi.mock("../core/index.js", () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock("../memory/persistent.js", () => ({
  writeMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock("../memory/search.js", () => ({
  searchMemory: vi.fn(),
}));

vi.mock("../memory/storage.js", () => ({
  readChunk: vi.fn(),
}));

import { runAgentLoop } from "../core/index.js";
import { createServer } from "./server.js";

const mockRunAgentLoop = vi.mocked(runAgentLoop);

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("returns 200 with status ok and a timestamp", async () => {
      const app = createServer();
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("string");
      // Verify it's a valid ISO date string
      expect(Number.isNaN(new Date(body.timestamp).getTime())).toBe(false);
    });

    it("returns a valid ISO timestamp", async () => {
      const app = createServer();
      const res = await app.request("/health");
      const body = await res.json();

      const date = new Date(body.timestamp);
      expect(date.toISOString()).toBe(body.timestamp);
    });
  });

  describe("POST /chat", () => {
    it("returns agent response for valid input", async () => {
      mockRunAgentLoop.mockResolvedValue({
        response: "Hello from Fern!",
        sessionId: "test_session",
        toolCalls: [],
      });

      const app = createServer();
      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toBe("Hello from Fern!");
    });

    it("uses provided sessionId", async () => {
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "my_session",
        toolCalls: [],
      });

      const app = createServer();
      await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi", sessionId: "my_session" }),
      });

      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "my_session" })
      );
    });

    it("generates sessionId when not provided", async () => {
      mockRunAgentLoop.mockResolvedValue({
        response: "ok",
        sessionId: "generated",
        toolCalls: [],
      });

      const app = createServer();
      await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hi" }),
      });

      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.stringMatching(/^chat_\d+_[a-z0-9]+$/),
        })
      );
    });

    it("returns 400 for empty message", async () => {
      const app = createServer();
      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("returns 400 for missing message field", async () => {
      const app = createServer();
      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notMessage: "hello" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid input");
    });

    it("returns 500 when agent loop throws", async () => {
      mockRunAgentLoop.mockRejectedValue(new Error("LLM is down"));

      const app = createServer();
      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello" }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("LLM is down");
    });

    it("returns 500 with 'Unknown error' for non-Error exceptions", async () => {
      mockRunAgentLoop.mockRejectedValue("string error");

      const app = createServer();
      const res = await app.request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello" }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Unknown error");
    });
  });

  describe("404 handler", () => {
    it("returns 404 for unknown routes", async () => {
      const app = createServer();
      const res = await app.request("/nonexistent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Not found");
    });
  });

  describe("CORS", () => {
    it("includes CORS allow-origin header set to wildcard", async () => {
      const app = createServer();
      const res = await app.request("/health", {
        headers: { Origin: "https://example.com" },
      });

      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });
});
