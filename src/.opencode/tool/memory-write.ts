import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

export const memory_write = tool({
  description:
    "Save a persistent memory that should be remembered across conversations. Use for durable information: user preferences, important facts, or lessons learned from mistakes. Don't store transient conversation details or things that will change soon. Good tags improve search recall — use 2-3 specific, descriptive tags per memory. Before writing a duplicate, search first to check if the memory already exists.",
  args: {
    type: tool.schema
      .enum(["fact", "preference", "learning"])
      .describe(
        "Category: 'fact' (objective info), 'preference' (user likes/dislikes), 'learning' (lessons learned)"
      ),
    content: tool.schema.string().describe("The memory content to store"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional tags for organization"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/memory/write`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          type: args.type,
          content: args.content,
          tags: args.tags ?? [],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error saving memory: ${err}`;
      }
      const memory = (await res.json()) as { id: string; type: string; content: string };
      return `Memory saved: ${memory.id} [${memory.type}] ${memory.content.slice(0, 100)}${memory.content.length > 100 ? "..." : ""}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error saving memory: ${msg}`;
    }
  },
});
