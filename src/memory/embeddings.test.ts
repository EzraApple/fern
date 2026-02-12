import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock config
vi.mock("@/memory/config.js", () => ({
  getMemoryConfig: () => ({
    embeddingModel: "text-embedding-3-small",
  }),
}));

// Mock the config/config.js module for the API key
vi.mock("@/config/config.js", () => ({
  getOpenAIApiKey: () => "test-api-key",
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { embedBatch, embedText } from "@/memory/embeddings.js";

describe("embedBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty input", async () => {
    const result = await embedBatch([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls OpenAI embeddings API with correct params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    });

    await embedBatch(["hello"]);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: ["hello"],
        }),
      })
    );
  });

  it("returns embeddings from API response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    });

    const result = await embedBatch(["text1", "text2"]);
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(embedBatch(["hello"])).rejects.toThrow(
      "OpenAI embeddings failed: 401 Unauthorized"
    );
  });

  it("handles missing data field in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await embedBatch(["hello"]);
    expect(result).toEqual([]);
  });

  it("handles missing embedding field in data entries", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1] }, {}],
      }),
    });

    const result = await embedBatch(["text1", "text2"]);
    expect(result).toEqual([[0.1], []]);
  });
});

describe("embedText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embeds a single text and returns the vector", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.5, 0.6, 0.7] }],
      }),
    });

    const result = await embedText("hello");
    expect(result).toEqual([0.5, 0.6, 0.7]);
  });

  it("returns empty array when API returns empty data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const result = await embedText("hello");
    expect(result).toEqual([]);
  });
});
