import { tool } from "@opencode-ai/plugin";
import type { UnifiedSearchResult } from "../../memory/types.js";

function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || "4000"}`;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.FERN_API_SECRET;
  if (secret) {
    headers["X-Fern-Secret"] = secret;
  }
  return headers;
}

export const memory_search = tool({
  description:
    "Search past conversations and saved memories using hybrid vector + keyword search. Returns results from both archived conversation summaries and persistent memories (facts, preferences, learnings). This is a two-phase retrieval system: search results show summaries — use memory_read with the chunkId/threadId from archive results to get the full original messages. Use natural language queries for best results (e.g., 'user's timezone preference' not 'timezone'). Search early in a conversation if the user references past context.",
  args: {
    query: tool.schema.string().describe("Search query — what are you trying to remember?"),
    limit: tool.schema.number().optional().describe("Max results to return (default: 5)"),
    threadId: tool.schema.string().optional().describe("Filter to a specific conversation thread"),
  },
  async execute(args) {
    let results: UnifiedSearchResult[];
    try {
      const res = await fetch(`${getFernUrl()}/internal/memory/search`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          query: args.query,
          limit: args.limit ?? 5,
          threadId: args.threadId,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error searching memory: ${err}`;
      }
      results = (await res.json()) as UnifiedSearchResult[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching memory: ${msg}`;
    }

    if (results.length === 0) {
      return "No memories match your query.";
    }

    return JSON.stringify(
      results.map((r) => {
        if (r.source === "archive") {
          return {
            source: "archive",
            chunkId: r.id,
            threadId: r.threadId,
            summary: r.text,
            relevance: r.relevanceScore.toFixed(2),
            tokenCount: r.tokenCount,
            time: r.timeRange
              ? `${new Date(r.timeRange.start).toISOString()} to ${new Date(r.timeRange.end).toISOString()}`
              : undefined,
          };
        }
        return {
          source: "memory",
          id: r.id,
          type: r.memoryType,
          content: r.text,
          relevance: r.relevanceScore.toFixed(2),
          tags: r.tags,
        };
      }),
      null,
      2
    );
  },
});
