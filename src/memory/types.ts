/**
 * Types for the async memory archival system.
 *
 * This system shadows OpenCode sessions, capturing chunks of conversation
 * history before they're lost to compaction, storing {summary, messages} pairs
 * for two-phase retrieval.
 */

/** Represents a single archived chunk of conversation history */
export interface ArchiveChunk {
  id: string;
  threadId: string;
  openCodeSessionId: string;
  summary: string;
  messages: OpenCodeMessage[];
  tokenCount: number;
  messageCount: number;
  messageRange: {
    firstMessageId: string;
    lastMessageId: string;
    firstTimestamp: number;
    lastTimestamp: number;
  };
  createdAt: string;
}

/** OpenCode message stored verbatim for perfect recall */
export interface OpenCodeMessage {
  id: string;
  sessionID: string;
  role: "user" | "assistant" | "system";
  time: { created: number; completed?: number };
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
  cost?: number;
  parts: OpenCodePart[];
  [key: string]: unknown;
}

/** Part of an OpenCode message */
export interface OpenCodePart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: string;
    time?: { start: number; end: number };
  };
  [key: string]: unknown;
}

/** Tracks how far archival has progressed for a thread */
export interface ArchiveWatermark {
  lastArchivedMessageIndex: number;
  lastArchivedMessageId: string;
  totalArchivedTokens: number;
  totalChunks: number;
  lastArchivedAt: string;
  /** OpenCode session this watermark applies to. If the session changes, archival resets to index 0. */
  openCodeSessionId?: string;
}

/** Entry in the summary search index (one per chunk) */
export interface SummaryIndexEntry {
  chunkId: string;
  threadId: string;
  summary: string;
  tokenCount: number;
  createdAt: string;
  timeRange: {
    start: number;
    end: number;
  };
}

/** Persistent agent-written memory */
export interface PersistentMemory {
  id: string;
  type: "fact" | "preference" | "learning";
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** Unified search result (from either archive summaries or persistent memories) */
export interface UnifiedSearchResult {
  id: string;
  source: "archive" | "memory";
  text: string;
  relevanceScore: number;
  // Archive-specific (present when source === "archive")
  threadId?: string;
  tokenCount?: number;
  timeRange?: { start: number; end: number };
  // Memory-specific (present when source === "memory")
  memoryType?: "fact" | "preference" | "learning";
  tags?: string[];
}

/** Configuration for the memory archival system */
export interface MemoryArchivalConfig {
  enabled: boolean;
  storagePath: string;
  chunkTokenThreshold: number;
  chunkTokenMin: number;
  chunkTokenMax: number;
  summarizationModel: string;
  summarizationBaseUrl?: string;
  maxSummaryTokens: number;
  embeddingModel: string;
  dbPath: string;
}

/** Configuration for automatic memory retrieval */
export interface AutoRetrievalConfig {
  /** Enable automatic memory retrieval (default: true) */
  enabled: boolean;
  /** Number of memories to retrieve (default: 3) */
  topK: number;
  /** Minimum relevance score to include (0-1, default: 0.3) */
  minRelevance: number;
  /** Maximum characters of memory text to include (default: 2000) */
  maxContextChars: number;
  /** Whether to search across all threads or just current (default: false = all threads) */
  threadScoped: boolean;
}

/** Represents a retrieved memory formatted for context injection */
export interface RetrievedMemory {
  text: string;
  source: "archive" | "memory";
  relevance: number;
  /** For archives: the time range of the original conversation */
  timeRange?: { start: Date; end: Date };
  /** For persistent memories: the type */
  memoryType?: "fact" | "preference" | "learning";
  tags?: string[];
}
