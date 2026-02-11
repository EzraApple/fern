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

export const memory_write = tool({
  description:
    "Save a persistent memory — a fact, preference, or learning that should be remembered across conversations. Use this to store important information you want to recall later.",
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
