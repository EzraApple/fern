import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unloadOllamaModel, isOllamaHealthy } from "@/services/integrations/ollama.js";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL } from "@/constants/models.js";

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock the logger to prevent console output during tests
vi.mock("@/config/index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Ollama Service", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Clear env vars
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("isOllamaHealthy", () => {
    it("should return true when Ollama responds with OK", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const result = await isOllamaHealthy();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/tags",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it("should return false when Ollama responds with error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await isOllamaHealthy();

      expect(result).toBe(false);
    });

    it("should return false when fetch throws an error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await isOllamaHealthy();

      expect(result).toBe(false);
    });

    it("should return false on timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const result = await isOllamaHealthy();

      expect(result).toBe(false);
    });

    it("should use custom base URL from env var", async () => {
      process.env.OLLAMA_BASE_URL = "http://custom-host:8080";
      mockFetch.mockResolvedValueOnce({ ok: true });

      await isOllamaHealthy();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://custom-host:8080/api/tags",
        expect.any(Object)
      );
    });

    it("should strip /v1 from base URL if present", async () => {
      // The DEFAULT_OLLAMA_BASE_URL includes /v1, which should be stripped
      mockFetch.mockResolvedValueOnce({ ok: true });

      await isOllamaHealthy();

      // Should call without /v1 - calling the native Ollama API
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tags"),
        expect.any(Object)
      );
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/v1/api/tags"),
        expect.any(Object)
      );
    });
  });

  describe("unloadOllamaModel", () => {
    it("should send request to unload model with keep_alive: 0", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await unloadOllamaModel();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining('"keep_alive":0'),
        })
      );
    });

    it("should use default model name in request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    });

    it("should use custom model from env var", async () => {
      process.env.OLLAMA_MODEL = "custom-model:latest";
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe("custom-model:latest");
    });

    it("should use custom base URL from env var", async () => {
      process.env.OLLAMA_BASE_URL = "http://custom-host:8080";
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://custom-host:8080/api/generate",
        expect.any(Object)
      );
    });

    it("should handle non-OK response gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      // Should not throw
      await expect(unloadOllamaModel()).resolves.not.toThrow();
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      // Should not throw
      await expect(unloadOllamaModel()).resolves.not.toThrow();
    });

    it("should have a timeout for the request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].signal).toBeDefined();
    });
  });

  describe("Phase 3: Ollama integration requirements", () => {
    it("should use /api/generate endpoint for unloading (native Ollama API)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/generate"),
        expect.any(Object)
      );
    });

    it("should use /api/tags endpoint for health check (native Ollama API)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await isOllamaHealthy();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/tags"),
        expect.any(Object)
      );
    });

    it("should use keep_alive: 0 to immediately unload model from VRAM", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await unloadOllamaModel();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.keep_alive).toBe(0);
    });
  });
});
