import { getMemoryConfig } from "@/memory/config.js";
import { searchMemory } from "@/memory/search.js";

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

const DEFAULT_CONFIG: AutoRetrievalConfig = {
  enabled: true,
  topK: 3,
  minRelevance: 0.3,
  maxContextChars: 2000,
  threadScoped: false,
};

let cachedAutoRetrievalConfig: AutoRetrievalConfig | null = null;

/**
 * Get auto-retrieval configuration from environment variables
 */
export function getAutoRetrievalConfig(): AutoRetrievalConfig {
  if (cachedAutoRetrievalConfig) {
    return cachedAutoRetrievalConfig;
  }

  const config = { ...DEFAULT_CONFIG };

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const enabled = process.env["FERN_AUTO_MEMORY_ENABLED"];
  if (enabled !== undefined) {
    config.enabled = enabled !== "false";
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const topK = process.env["FERN_AUTO_MEMORY_TOP_K"];
  if (topK) {
    const parsed = Number.parseInt(topK, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.topK = Math.min(parsed, 10); // Cap at 10
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const minRelevance = process.env["FERN_AUTO_MEMORY_MIN_RELEVANCE"];
  if (minRelevance) {
    const parsed = Number.parseFloat(minRelevance);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      config.minRelevance = parsed;
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const maxChars = process.env["FERN_AUTO_MEMORY_MAX_CHARS"];
  if (maxChars) {
    const parsed = Number.parseInt(maxChars, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      config.maxContextChars = parsed;
    }
  }

  // biome-ignore lint/complexity/useLiteralKeys: env var access
  const threadScoped = process.env["FERN_AUTO_MEMORY_THREAD_SCOPED"];
  if (threadScoped !== undefined) {
    config.threadScoped = threadScoped === "true";
  }

  cachedAutoRetrievalConfig = config;
  return config;
}

/**
 * Clear the cached config (for testing)
 */
export function clearAutoRetrievalConfigCache(): void {
  cachedAutoRetrievalConfig = null;
}

/**
 * Represents a retrieved memory formatted for context injection
 */
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

/**
 * Automatically retrieve relevant memories for a user message
 * Returns null if auto-retrieval is disabled or no relevant memories found
 */
export async function retrieveRelevantMemories(
  message: string,
  threadId?: string
): Promise<RetrievedMemory[] | null> {
  const memoryConfig = getMemoryConfig();
  if (!memoryConfig.enabled) {
    return null;
  }

  const config = getAutoRetrievalConfig();
  if (!config.enabled) {
    return null;
  }

  // Skip very short messages (likely not enough context for meaningful search)
  if (message.trim().length < 3) {
    return null;
  }

  try {
    const results = await searchMemory(message, {
      limit: config.topK * 2, // Fetch more to filter by relevance
      threadId: config.threadScoped ? threadId : undefined,
      minScore: config.minRelevance,
    });

    if (results.length === 0) {
      return null;
    }

    // Filter by relevance and format
    const memories: RetrievedMemory[] = results
      .filter((r) => r.relevanceScore >= config.minRelevance)
      .slice(0, config.topK)
      .map((r) => ({
        text: r.text,
        source: r.source,
        relevance: r.relevanceScore,
        timeRange:
          r.timeRange && r.source === "archive"
            ? { start: new Date(r.timeRange.start), end: new Date(r.timeRange.end) }
            : undefined,
        memoryType: r.memoryType,
        tags: r.tags,
      }));

    return memories.length > 0 ? memories : null;
  } catch (error) {
    // Log but don't fail - auto-retrieval is best-effort
    console.warn("[AutoMemory] Retrieval failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Format retrieved memories for injection into system prompt
 * Returns empty string if no memories or formatting fails
 */
export function formatMemoriesForContext(memories: RetrievedMemory[] | null): string {
  if (!memories || memories.length === 0) {
    return "";
  }

  const config = getAutoRetrievalConfig();
  let totalChars = 0;
  const formattedMemories: string[] = [];

  for (const memory of memories) {
    const formatted = formatSingleMemory(memory);
    if (totalChars + formatted.length > config.maxContextChars) {
      break;
    }
    formattedMemories.push(formatted);
    totalChars += formatted.length;
  }

  if (formattedMemories.length === 0) {
    return "";
  }

  return [
    "",
    "## Relevant Context from Memory",
    "The following information from past conversations may be relevant:",
    "",
    ...formattedMemories,
    "",
  ].join("\n");
}

function formatSingleMemory(memory: RetrievedMemory): string {
  const parts: string[] = [];

  if (memory.source === "archive") {
    // Archive summary
    parts.push("[Past Conversation]");
    if (memory.timeRange) {
      const date = memory.timeRange.start.toLocaleDateString();
      parts.push(`(${date})`);
    }
    parts.push(":");
    parts.push(memory.text);
  } else {
    // Persistent memory
    const type = memory.memoryType || "fact";
    parts.push(`[${type.charAt(0).toUpperCase() + type.slice(1)}]`);
    if (memory.tags && memory.tags.length > 0) {
      parts.push(`(${memory.tags.join(", ")})`);
    }
    parts.push(":");
    parts.push(memory.text);
  }

  return parts.join(" ");
}
