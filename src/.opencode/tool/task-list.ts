import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

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
