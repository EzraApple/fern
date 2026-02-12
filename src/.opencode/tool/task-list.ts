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

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  sortOrder: number;
}

function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks for this session.";
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const icons: Record<string, string> = {
    pending: "[ ]",
    in_progress: "[>]",
    done: "[x]",
    cancelled: "[-]",
  };
  const lines = tasks.map(
    (t, i) =>
      `  ${i + 1}. ${icons[t.status] || "[ ]"} ${t.title}${t.description ? ` — ${t.description}` : ""}`
  );
  return `Tasks (${doneCount}/${tasks.length} done):\n${lines.join("\n")}`;
}

export const task_list = tool({
  description:
    "List all tasks for the current session. Use to check progress, see what's planned, or get an overview. Shows a formatted checklist with status indicators: [ ] pending, [>] in progress, [x] done, [-] cancelled.",
  args: {
    threadId: tool.schema
      .string()
      .describe("Your session ID from the system prompt (e.g., 'whatsapp_+1234567890')"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/tasks/list`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ threadId: args.threadId }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error listing tasks: ${err}`;
      }

      const tasks = (await res.json()) as Task[];
      return formatTaskList(tasks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error listing tasks: ${msg}`;
    }
  },
});
