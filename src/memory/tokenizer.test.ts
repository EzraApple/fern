import { estimateMessageTokens, estimateMessagesTokens } from "@/memory/tokenizer.js";
import type { OpenCodeMessage } from "@/memory/types.js";
import { describe, expect, it } from "vitest";

function makeMessage(overrides: Partial<OpenCodeMessage> = {}): OpenCodeMessage {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "user",
    time: { created: Date.now() },
    parts: [],
    ...overrides,
  };
}

describe("estimateMessageTokens", () => {
  it("uses token metadata when available", () => {
    const msg = makeMessage({
      tokens: { input: 100, output: 200, reasoning: 50 },
    });
    expect(estimateMessageTokens(msg)).toBe(350);
  });

  it("uses only non-zero token fields", () => {
    const msg = makeMessage({
      tokens: { input: 0, output: 500, reasoning: 0 },
    });
    expect(estimateMessageTokens(msg)).toBe(500);
  });

  it("falls back to text heuristic when tokens total is zero", () => {
    const msg = makeMessage({
      tokens: { input: 0, output: 0, reasoning: 0 },
      parts: [{ id: "p1", type: "text", text: "a".repeat(100) }],
    });
    // 100 chars / 4 = 25
    expect(estimateMessageTokens(msg)).toBe(25);
  });

  it("falls back to text heuristic when tokens field is missing", () => {
    const msg = makeMessage({
      parts: [{ id: "p1", type: "text", text: "a".repeat(80) }],
    });
    // 80 chars / 4 = 20
    expect(estimateMessageTokens(msg)).toBe(20);
  });

  it("counts text from multiple parts", () => {
    const msg = makeMessage({
      parts: [
        { id: "p1", type: "text", text: "a".repeat(40) },
        { id: "p2", type: "text", text: "b".repeat(60) },
      ],
    });
    // 100 / 4 = 25
    expect(estimateMessageTokens(msg)).toBe(25);
  });

  it("includes tool state input in text estimation", () => {
    const msg = makeMessage({
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "echo",
          state: { input: { text: "hello" }, status: "done" },
        },
      ],
    });
    const inputJson = JSON.stringify({ text: "hello" });
    expect(estimateMessageTokens(msg)).toBe(Math.ceil(inputJson.length / 4));
  });

  it("includes tool state output in text estimation", () => {
    const msg = makeMessage({
      parts: [
        {
          id: "p1",
          type: "tool",
          tool: "echo",
          state: { output: "a".repeat(200), status: "done" },
        },
      ],
    });
    expect(estimateMessageTokens(msg)).toBe(Math.ceil(200 / 4));
  });

  it("combines text, input, and output for estimation", () => {
    const msg = makeMessage({
      parts: [
        { id: "p1", type: "text", text: "a".repeat(40) },
        {
          id: "p2",
          type: "tool",
          tool: "test",
          state: {
            input: "x",
            output: "b".repeat(20),
            status: "done",
          },
        },
      ],
    });
    const inputLen = JSON.stringify("x").length;
    const total = 40 + inputLen + 20;
    expect(estimateMessageTokens(msg)).toBe(Math.ceil(total / 4));
  });

  it("returns 0 for empty parts", () => {
    const msg = makeMessage({ parts: [] });
    expect(estimateMessageTokens(msg)).toBe(0);
  });

  it("rounds up with Math.ceil", () => {
    const msg = makeMessage({
      parts: [{ id: "p1", type: "text", text: "abc" }],
    });
    // 3 / 4 = 0.75 -> ceil = 1
    expect(estimateMessageTokens(msg)).toBe(1);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums token counts for multiple messages", () => {
    const msgs = [
      makeMessage({ tokens: { input: 100, output: 0, reasoning: 0 } }),
      makeMessage({ tokens: { input: 200, output: 0, reasoning: 0 } }),
    ];
    expect(estimateMessagesTokens(msgs)).toBe(300);
  });

  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("mixes token metadata and text heuristic", () => {
    const msgs = [
      makeMessage({ tokens: { input: 100, output: 0, reasoning: 0 } }),
      makeMessage({
        parts: [{ id: "p1", type: "text", text: "a".repeat(80) }],
      }),
    ];
    // 100 + 20 = 120
    expect(estimateMessagesTokens(msgs)).toBe(120);
  });
});
