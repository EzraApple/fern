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

export const memory_delete = tool({
  description:
    "Delete a persistent memory by ID. Use when the user asks you to forget something, or when a memory is outdated/incorrect. Get the memory ID from memory_search or memory_list first.",
  args: {
    id: tool.schema.string().describe("The memory ID to delete (e.g., 'mem_01ABC...')"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/memory/delete/${args.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error deleting memory: ${err}`;
      }
      const result = (await res.json()) as { deleted: boolean };
      return result.deleted
        ? `Memory ${args.id} deleted.`
        : `Memory ${args.id} not found — may have already been deleted.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error deleting memory: ${msg}`;
    }
  },
});
