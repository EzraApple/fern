import type { PersistentMemory } from "@/memory/types.js";
import { tool } from "@opencode-ai/plugin";

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

export const memory_list = tool({
  description:
    "List all persistent memories, optionally filtered by type. Use when the user asks what you remember, wants to review stored memories, or before writing a memory to check for duplicates. Returns memories sorted by newest first.",
  args: {
    type: tool.schema
      .enum(["fact", "preference", "learning"])
      .optional()
      .describe("Filter by memory type (omit for all types)"),
    limit: tool.schema.number().optional().describe("Max results to return (default: 50)"),
  },
  async execute(args) {
    try {
      const params = new URLSearchParams();
      if (args.type) params.set("type", args.type);
      if (args.limit) params.set("limit", String(args.limit));

      const url = `${getFernUrl()}/internal/memory/list${params.size > 0 ? `?${params}` : ""}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.text();
        return `Error listing memories: ${err}`;
      }
      const memories = (await res.json()) as PersistentMemory[];

      if (memories.length === 0) {
        return "No persistent memories stored.";
      }

      return JSON.stringify(
        memories.map((m) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          tags: m.tags,
          created: m.createdAt,
        })),
        null,
        2
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error listing memories: ${msg}`;
    }
  },
});
