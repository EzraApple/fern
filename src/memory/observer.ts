import { getSessionMessages } from "@/core/opencode/queries.js";
import { getMemoryConfig } from "@/memory/config.js";
import { insertSummary } from "@/memory/db/summaries.js";
import { embedText } from "@/memory/embeddings.js";
import {
  ensureStorageDirectories,
  readWatermark,
  writeChunk,
  writeWatermark,
} from "@/memory/storage.js";
import { summarizeChunk } from "@/memory/summarizer.js";
import { estimateMessageTokens, estimateMessagesTokens } from "@/memory/tokenizer.js";
import type {
  ArchiveChunk,
  ArchiveWatermark,
  OpenCodeMessage,
  SummaryIndexEntry,
} from "@/memory/types.js";
import PQueue from "p-queue";
import { ulid } from "ulid";

/** Per-thread archival queues to prevent concurrent archival on the same thread */
const archivalQueues = new Map<string, PQueue>();

function getQueue(threadId: string): PQueue {
  let queue = archivalQueues.get(threadId);
  if (!queue) {
    queue = new PQueue({ concurrency: 1 });
    archivalQueues.set(threadId, queue);
  }
  return queue;
}

/**
 * Called after each agent turn completes.
 * Fires and forgets — errors are logged, never propagated.
 */
export async function onTurnComplete(threadId: string, sessionId: string): Promise<void> {
  const config = getMemoryConfig();
  if (!config.enabled) return;

  const queue = getQueue(threadId);
  await queue.add(() => checkAndArchive(threadId, sessionId));
}

async function checkAndArchive(threadId: string, sessionId: string): Promise<void> {
  const config = getMemoryConfig();

  // 1. Fetch all messages from OpenCode
  const rawMessages = await getSessionMessages(sessionId);
  const messages = rawMessages as OpenCodeMessage[];

  if (messages.length === 0) return;

  // 2. Load watermark to find where we left off
  const watermark = readWatermark(threadId);
  let startIndex: number;

  if (!watermark) {
    // First archival for this thread
    startIndex = 0;
  } else if (!watermark.openCodeSessionId || watermark.openCodeSessionId !== sessionId) {
    // Session rolled over (or legacy watermark without session tracking) — reset to 0
    console.info(
      `[Memory] Session rollover detected for thread ${threadId} (was: ${watermark.openCodeSessionId ?? "unknown"}, now: ${sessionId}). Resetting archival cursor.`
    );
    startIndex = 0;
  } else {
    startIndex = watermark.lastArchivedMessageIndex + 1;
  }

  // 3. Calculate unarchived messages
  const unarchivedMessages = messages.slice(startIndex);
  if (unarchivedMessages.length === 0) return;

  const unarchivedTokens = estimateMessagesTokens(unarchivedMessages);

  // 4. Check if we've crossed the chunk threshold
  if (unarchivedTokens < config.chunkTokenThreshold) return;

  // 5. Build a chunk from the oldest unarchived messages
  const chunkMessages = buildChunkMessages(unarchivedMessages, config);
  if (chunkMessages.length === 0) return;

  const chunkTokens = estimateMessagesTokens(chunkMessages);
  console.info(
    `[Memory] Archiving chunk: ${chunkMessages.length} messages, ~${chunkTokens} tokens for thread ${threadId}`
  );

  // 6. Summarize the chunk
  const summary = await summarizeChunk(chunkMessages, config);
  console.info(`[Memory] Summary generated (${summary.length} chars) for thread ${threadId}`);

  // 7. Build and store the archive chunk
  const chunkId = `chunk_${ulid()}`;
  const firstMsg = chunkMessages[0] as OpenCodeMessage;
  const lastMsg = chunkMessages[chunkMessages.length - 1] as OpenCodeMessage;

  const archiveChunk: ArchiveChunk = {
    id: chunkId,
    threadId,
    openCodeSessionId: sessionId,
    summary,
    messages: chunkMessages,
    tokenCount: chunkTokens,
    messageCount: chunkMessages.length,
    messageRange: {
      firstMessageId: firstMsg.id,
      lastMessageId: lastMsg.id,
      firstTimestamp: firstMsg.time?.created ?? Date.now(),
      lastTimestamp: lastMsg.time?.created ?? Date.now(),
    },
    createdAt: new Date().toISOString(),
  };

  ensureStorageDirectories(threadId);
  writeChunk(archiveChunk);

  // 8. Embed summary and insert into SQLite
  const indexEntry: SummaryIndexEntry = {
    chunkId,
    threadId,
    summary,
    tokenCount: chunkTokens,
    createdAt: archiveChunk.createdAt,
    timeRange: {
      start: archiveChunk.messageRange.firstTimestamp,
      end: archiveChunk.messageRange.lastTimestamp,
    },
  };

  let embedding: number[] = [];
  try {
    embedding = await embedText(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Memory] Failed to embed summary (inserting without vector): ${msg}`);
  }
  insertSummary(indexEntry, embedding);

  // 9. Advance watermark
  const newArchivedIndex = startIndex + chunkMessages.length - 1;
  const newWatermark: ArchiveWatermark = {
    lastArchivedMessageIndex: newArchivedIndex,
    lastArchivedMessageId: lastMsg.id,
    totalArchivedTokens: (watermark?.totalArchivedTokens ?? 0) + chunkTokens,
    totalChunks: (watermark?.totalChunks ?? 0) + 1,
    lastArchivedAt: new Date().toISOString(),
    openCodeSessionId: sessionId,
  };
  writeWatermark(threadId, newWatermark);

  console.info(
    `[Memory] Chunk ${chunkId} stored. Watermark advanced to message index ${newArchivedIndex}.`
  );
}

/**
 * Select messages for a chunk, respecting token limits.
 * Takes from the start of the array (oldest unarchived) up to chunkTokenMax.
 */
function buildChunkMessages(
  messages: OpenCodeMessage[],
  config: { chunkTokenMin: number; chunkTokenMax: number }
): OpenCodeMessage[] {
  const chunk: OpenCodeMessage[] = [];
  let tokens = 0;

  for (const msg of messages) {
    const msgTokens = estimateMessageTokens(msg);

    // Stop if adding this message would exceed the max
    if (tokens + msgTokens > config.chunkTokenMax && chunk.length > 0) {
      break;
    }

    chunk.push(msg);
    tokens += msgTokens;
  }

  // Don't create chunks that are too small (unless that's all we have above threshold)
  if (tokens < config.chunkTokenMin && chunk.length < messages.length) {
    return [];
  }

  return chunk;
}
