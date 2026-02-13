import type { UnifiedSearchResult } from "@/memory/types.js";
import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

export const memory_search = tool({
  description: `Search your memory of past conversations and stored knowledge.

WHEN TO USE — search proactively when:
- The user references something from a previous conversation ("remember when...", "like we discussed", "last time")
- The user asks about their own preferences, setup, or past decisions
- You need context about past work (PRs submitted, bugs fixed, features discussed)
- A conversation topic might have prior context you've forgotten
- The user seems to expect you to know something you don't have in the current session

Don't wait to be asked — if there's a reasonable chance past context would improve your response, search first.

Returns summaries from archived conversations and persistent memories (facts, preferences, learnings). For full transcripts, follow up with memory_read using the chunkId/threadId from results.

Use natural language queries for best results (e.g., "user's timezone preference" not "timezone"). Be specific — narrow queries get better matches than broad ones.`,
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
