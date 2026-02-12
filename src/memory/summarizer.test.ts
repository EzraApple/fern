import type { MemoryArchivalConfig, OpenCodeMessage } from "@/memory/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock OpenAI
const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

// Mock config
vi.mock("@/config/config.js", () => ({
  getOpenAIApiKey: () => "test-api-key",
  getMoonshotApiKey: () => undefined,
}));

import { summarizeChunk } from "@/memory/summarizer.js";

const testConfig: MemoryArchivalConfig = {
  enabled: true,
  storagePath: "/tmp/test",
  chunkTokenThreshold: 25_000,
  chunkTokenMin: 15_000,
  chunkTokenMax: 40_000,
  summarizationModel: "gpt-4o-mini",
  maxSummaryTokens: 1024,
  embeddingModel: "text-embedding-3-small",
  dbPath: "/tmp/test/fern.db",
};

function makeMessage(role: "user" | "assistant", text: string): OpenCodeMessage {
  return {
    id: `msg-${Math.random()}`,
    sessionID: "sess-1",
    role,
    time: { created: Date.now() },
    parts: [{ id: "p1", type: "text", text }],
  };
}

describe("summarizeChunk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns summary from OpenAI response", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "This is a summary." } }],
    });

    const messages = [makeMessage("user", "Hello"), makeMessage("assistant", "Hi there!")];

    const result = await summarizeChunk(messages, testConfig);
    expect(result).toBe("This is a summary.");
  });

  it("passes correct model and max_tokens to OpenAI", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Summary" } }],
    });

    await summarizeChunk([makeMessage("user", "test")], testConfig);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        max_tokens: 1024,
      })
    );
  });

  it("formats text messages as [Role]: text", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Summary" } }],
    });

    const messages = [makeMessage("user", "What is 2+2?"), makeMessage("assistant", "It's 4.")];

    await summarizeChunk(messages, testConfig);

    const userContent = mockCreate.mock.calls[0]?.[0].messages[1].content;
    expect(userContent).toContain("[User]: What is 2+2?");
    expect(userContent).toContain("[Assistant]: It's 4.");
  });

  it("formats tool parts with status and truncated input/output", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Summary" } }],
    });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg-1",
        sessionID: "sess-1",
        role: "assistant",
        time: { created: Date.now() },
        parts: [
          {
            id: "p1",
            type: "tool",
            tool: "echo",
            state: {
              status: "completed",
              input: { text: "hello" },
              output: "hello",
            },
          },
        ],
      },
    ];

    await summarizeChunk(messages, testConfig);

    const userContent = mockCreate.mock.calls[0]?.[0].messages[1].content;
    expect(userContent).toContain("[Tool: echo] (completed)");
    expect(userContent).toContain("hello");
  });

  it("returns fallback when OpenAI returns empty content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const messages = [makeMessage("user", "test")];
    const result = await summarizeChunk(messages, testConfig);
    expect(result).toContain("[Summary unavailable]");
    expect(result).toContain("1 messages");
  });

  it("returns fallback when OpenAI returns empty choices", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [] });

    const messages = [makeMessage("user", "test")];
    const result = await summarizeChunk(messages, testConfig);
    expect(result).toContain("[Summary unavailable]");
  });

  it("returns fallback with error message when API throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    const messages = [makeMessage("user", "test")];
    const result = await summarizeChunk(messages, testConfig);
    expect(result).toContain("[Summary unavailable]");
    expect(result).toContain("1 messages");
  });

  it("returns fallback with string error when non-Error is thrown", async () => {
    mockCreate.mockRejectedValueOnce("network failure");

    const messages = [makeMessage("user", "test")];
    const result = await summarizeChunk(messages, testConfig);
    expect(result).toContain("[Summary unavailable]");
  });

  it("handles messages with empty parts array", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Summary of empty" } }],
    });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg-empty",
        sessionID: "sess-1",
        role: "user",
        time: { created: Date.now() },
        parts: [],
      },
    ];

    const result = await summarizeChunk(messages, testConfig);
    expect(result).toBe("Summary of empty");
  });

  it("truncates long tool input and output in formatted text", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Summary" } }],
    });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg-1",
        sessionID: "sess-1",
        role: "assistant",
        time: { created: Date.now() },
        parts: [
          {
            id: "p1",
            type: "tool",
            tool: "bash",
            state: {
              status: "done",
              input: { command: "x".repeat(500) },
              output: "y".repeat(500),
            },
          },
        ],
      },
    ];

    await summarizeChunk(messages, testConfig);

    const userContent = mockCreate.mock.calls[0]?.[0].messages[1].content;
    // Input is JSON.stringify'd then sliced to 200 chars
    expect(userContent).toContain("[Tool: bash]");
    // Output is sliced to 300 chars
    expect(userContent.length).toBeLessThan(
      JSON.stringify({ command: "x".repeat(500) }).length + "y".repeat(500).length
    );
  });
});
