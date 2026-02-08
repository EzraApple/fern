import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveWatermark, OpenCodeMessage } from "./types.js";

// Mock PQueue to execute immediately
vi.mock("p-queue", () => ({
  default: class {
    async add(fn: () => Promise<void>) {
      await fn();
    }
  },
}));

// Mock ulid
vi.mock("ulid", () => ({
  ulid: () => "01TESTULID",
}));

// Mock config
vi.mock("./config.js", () => ({
  getMemoryConfig: () => ({
    enabled: true,
    storagePath: "/tmp/test-memory",
    chunkTokenThreshold: 100,
    chunkTokenMin: 50,
    chunkTokenMax: 200,
    summarizationModel: "gpt-4o-mini",
    maxSummaryTokens: 1024,
    embeddingModel: "text-embedding-3-small",
    dbPath: "/tmp/test-memory/fern.db",
  }),
}));

// Mock dependencies
const mockGetSessionMessages = vi.fn();
vi.mock("../core/opencode-service.js", () => ({
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
}));

const mockInsertSummary = vi.fn();
vi.mock("./db.js", () => ({
  insertSummary: (...args: unknown[]) => mockInsertSummary(...args),
}));

const mockEmbedText = vi.fn();
vi.mock("./embeddings.js", () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

const mockReadWatermark = vi.fn();
const mockWriteWatermark = vi.fn();
const mockWriteChunk = vi.fn();
const mockEnsureStorageDirectories = vi.fn();

vi.mock("./storage.js", () => ({
  readWatermark: (...args: unknown[]) => mockReadWatermark(...args),
  writeWatermark: (...args: unknown[]) => mockWriteWatermark(...args),
  writeChunk: (...args: unknown[]) => mockWriteChunk(...args),
  ensureStorageDirectories: (...args: unknown[]) => mockEnsureStorageDirectories(...args),
}));

const mockSummarizeChunk = vi.fn();
vi.mock("./summarizer.js", () => ({
  summarizeChunk: (...args: unknown[]) => mockSummarizeChunk(...args),
}));

import { onTurnComplete } from "./observer.js";

function makeMsg(id: string, tokenCount: number): OpenCodeMessage {
  return {
    id,
    sessionID: "sess-1",
    role: "user",
    time: { created: Date.now() },
    tokens: { input: tokenCount, output: 0, reasoning: 0 },
    parts: [{ id: `p-${id}`, type: "text", text: "test" }],
  };
}

describe("onTurnComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSummarizeChunk.mockResolvedValue("Test summary");
  });

  it("does nothing when memory is disabled", async () => {
    vi.resetModules();

    vi.doMock("./config.js", () => ({
      getMemoryConfig: () => ({
        enabled: false,
      }),
    }));

    const { onTurnComplete: otc } = await import("./observer.js");
    await otc("thread-1", "sess-1");

    expect(mockGetSessionMessages).not.toHaveBeenCalled();
  });

  it("does nothing when session has no messages", async () => {
    mockGetSessionMessages.mockResolvedValueOnce([]);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockSummarizeChunk).not.toHaveBeenCalled();
    expect(mockWriteChunk).not.toHaveBeenCalled();
  });

  it("does nothing when tokens are below threshold", async () => {
    // Config chunkTokenThreshold is 100, so 50 tokens won't trigger archival
    mockGetSessionMessages.mockResolvedValueOnce([makeMsg("msg-1", 50)]);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockSummarizeChunk).not.toHaveBeenCalled();
    expect(mockWriteChunk).not.toHaveBeenCalled();
  });

  it("archives when tokens exceed threshold", async () => {
    // 3 messages at 40 tokens each = 120 tokens, above threshold of 100
    const messages = [makeMsg("msg-1", 40), makeMsg("msg-2", 40), makeMsg("msg-3", 40)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockSummarizeChunk).toHaveBeenCalled();
    expect(mockWriteChunk).toHaveBeenCalled();
    expect(mockInsertSummary).toHaveBeenCalled();
    expect(mockWriteWatermark).toHaveBeenCalled();
  });

  it("starts from watermark position", async () => {
    // 5 messages total, watermark at index 2 (3 messages already archived)
    const messages = [
      makeMsg("msg-1", 30),
      makeMsg("msg-2", 30),
      makeMsg("msg-3", 30),
      makeMsg("msg-4", 60),
      makeMsg("msg-5", 60),
    ];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    const watermark: ArchiveWatermark = {
      lastArchivedMessageIndex: 2,
      lastArchivedMessageId: "msg-3",
      totalArchivedTokens: 90,
      totalChunks: 1,
      lastArchivedAt: "2024-01-01T00:00:00.000Z",
    };
    mockReadWatermark.mockReturnValueOnce(watermark);

    await onTurnComplete("thread-1", "sess-1");

    // Unarchived: msg-4 (60) + msg-5 (60) = 120 tokens, above threshold
    expect(mockSummarizeChunk).toHaveBeenCalled();
    // Verify the summarized chunk only includes unarchived messages
    const chunkMessages = mockSummarizeChunk.mock.calls[0][0] as OpenCodeMessage[];
    const chunkIds = chunkMessages.map((m) => m.id);
    expect(chunkIds).not.toContain("msg-1");
    expect(chunkIds).not.toContain("msg-2");
    expect(chunkIds).not.toContain("msg-3");
  });

  it("writes chunk to storage with correct structure", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockWriteChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "chunk_01TESTULID",
        threadId: "thread-1",
        openCodeSessionId: "sess-1",
        summary: "Test summary",
      })
    );
  });

  it("inserts summary entry into DB with embedding", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockInsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: "chunk_01TESTULID",
        threadId: "thread-1",
        summary: "Test summary",
      }),
      [0.1, 0.2, 0.3]
    );
  });

  it("advances watermark after archival", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockWriteWatermark).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        lastArchivedMessageIndex: 1,
        lastArchivedMessageId: "msg-2",
        totalChunks: 1,
      })
    );
  });

  it("accumulates watermark totals on subsequent archival", async () => {
    const messages = [
      makeMsg("msg-1", 30),
      makeMsg("msg-2", 30),
      makeMsg("msg-3", 30),
      makeMsg("msg-4", 60),
      makeMsg("msg-5", 60),
    ];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    const existingWatermark: ArchiveWatermark = {
      lastArchivedMessageIndex: 2,
      lastArchivedMessageId: "msg-3",
      totalArchivedTokens: 90,
      totalChunks: 1,
      lastArchivedAt: "2024-01-01T00:00:00.000Z",
    };
    mockReadWatermark.mockReturnValueOnce(existingWatermark);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockWriteWatermark).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        totalChunks: 2,
      })
    );
  });

  it("handles embedding failure gracefully", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);
    mockEmbedText.mockRejectedValueOnce(new Error("API error"));

    await onTurnComplete("thread-1", "sess-1");

    // Should still insert summary with empty embedding
    expect(mockInsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Test summary" }),
      []
    );
  });

  it("does not archive when chunk is too small and more messages remain", async () => {
    // chunkTokenMin is 50, chunkTokenMax is 200
    // All messages together are above threshold (100), but individually below chunkTokenMin
    // With chunkTokenMax=200, all 3 fit in the chunk (30+30+30=90 < 200)
    // But 90 < chunkTokenMin (50)? No, 90 > 50, so this actually would archive.
    // Let's make it so the total unarchived is above threshold but each msg is tiny
    // and total is below chunkTokenMin
    // Actually the buildChunkMessages logic: it accumulates until chunkTokenMax.
    // If the accumulated tokens < chunkTokenMin AND chunk.length < messages.length, return [].
    // So we need: unarchived tokens >= threshold, but the chunk we build < chunkTokenMin
    // That's tricky because the chunk includes all messages up to chunkTokenMax...
    // Let's test: 3 messages at 35 tokens = 105 total (above threshold 100)
    // chunkTokenMax=200, so all 3 fit: 105 tokens >= chunkTokenMin (50), so it archives.
    // To trigger the "too small" path: need chunk < chunkTokenMin AND chunk < all messages
    // E.g., 1 message at 40 tokens, then 1 message at 200 tokens
    // buildChunkMessages: msg1(40) fits, msg2(200) would exceed max (40+200=240>200), stop
    // chunk = [msg1], tokens=40 < chunkTokenMin(50), chunk.length(1) < messages.length(2) -> return []
    const messages = [makeMsg("msg-1", 40), makeMsg("msg-2", 200)];
    // Total = 240, above threshold of 100
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    // buildChunkMessages returns [] because 40 < chunkTokenMin(50) and there are more messages
    expect(mockWriteChunk).not.toHaveBeenCalled();
  });

  it("ensures storage directories are created", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockEnsureStorageDirectories).toHaveBeenCalledWith("thread-1");
  });

  it("includes a single message exceeding chunkTokenMax when it is the first message", async () => {
    // A single message at 250 tokens exceeds chunkTokenMax (200),
    // but buildChunkMessages includes it because chunk.length === 0
    const messages = [makeMsg("msg-1", 250)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);

    await onTurnComplete("thread-1", "sess-1");

    // Should still archive because the single oversized message is included
    expect(mockWriteChunk).toHaveBeenCalled();
    const chunk = mockWriteChunk.mock.calls[0][0];
    expect(chunk.messageCount).toBe(1);
  });

  it("does not archive when all messages are already archived", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    const watermark = {
      lastArchivedMessageIndex: 1,
      lastArchivedMessageId: "msg-2",
      totalArchivedTokens: 120,
      totalChunks: 1,
      lastArchivedAt: "2024-01-01T00:00:00.000Z",
    };
    mockReadWatermark.mockReturnValueOnce(watermark);

    await onTurnComplete("thread-1", "sess-1");

    expect(mockSummarizeChunk).not.toHaveBeenCalled();
    expect(mockWriteChunk).not.toHaveBeenCalled();
  });

  it("handles non-Error embedding failure gracefully", async () => {
    const messages = [makeMsg("msg-1", 60), makeMsg("msg-2", 60)];
    mockGetSessionMessages.mockResolvedValueOnce(messages);
    mockReadWatermark.mockReturnValueOnce(null);
    mockEmbedText.mockRejectedValueOnce("string error");

    await onTurnComplete("thread-1", "sess-1");

    // Should still insert summary with empty embedding
    expect(mockInsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({ summary: "Test summary" }),
      []
    );
  });
});
