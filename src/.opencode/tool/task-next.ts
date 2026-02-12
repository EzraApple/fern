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

export const task_next = tool({
  description:
    "Get the next task to work on. Returns the first in-progress task, or the first pending task by sort order. Use this to deterministically pick what to do next instead of guessing.",
  args: {
    threadId: tool.schema
      .string()
      .describe("Your session ID from the system prompt (e.g., 'whatsapp_+1234567890')"),
  },
  async execute(args) {
    try {
      const res = await fetch(
        `${getFernUrl()}/internal/tasks/next?threadId=${encodeURIComponent(args.threadId)}`,
        { method: "GET", headers: getAuthHeaders() }
      );
      if (!res.ok) {
        const err = await res.text();
        return `Error getting next task: ${err}`;
      }

      const data = (await res.json()) as {
        task: {
          id: string;
          title: string;
          description?: string;
          status: string;
        } | null;
      };
      if (!data.task) {
        // Check if there are any tasks at all
        const listRes = await fetch(`${getFernUrl()}/internal/tasks/list`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ threadId: args.threadId }),
        });
        if (listRes.ok) {
          const tasks = (await listRes.json()) as { status: string }[];
          if (tasks.length > 0) return "All tasks done!";
        }
        return "No tasks for this session.";
      }

      let result = `Next: ${data.task.id} — ${data.task.title}`;
      if (data.task.description) result += `\nDetails: ${data.task.description}`;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error getting next task: ${msg}`;
    }
  },
});
