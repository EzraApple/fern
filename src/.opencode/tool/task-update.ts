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
  threadId: string;
  title: string;
  description?: string;
  status: string;
  sortOrder: number;
}

function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks.";
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

export const task_update = tool({
  description:
    "Update a task's status or details. Mark `in_progress` when you start working on it, `done` when finished, `cancelled` if no longer relevant. Returns the full task list after updating.",
  args: {
    id: tool.schema.string().describe("Task ID (e.g., 'task_01ABC...')"),
    status: tool.schema
      .enum(["pending", "in_progress", "done", "cancelled"])
      .optional()
      .describe("New status"),
    title: tool.schema.string().optional().describe("Updated title"),
    description: tool.schema.string().optional().describe("Updated description"),
    threadId: tool.schema
      .string()
      .describe("Your session ID from the system prompt (needed to return the full task list)"),
  },
  async execute(args) {
    try {
      const updateBody: Record<string, unknown> = {};
      if (args.status) updateBody.status = args.status;
      if (args.title) updateBody.title = args.title;
      if (args.description) updateBody.description = args.description;

      const updateRes = await fetch(`${getFernUrl()}/internal/tasks/update/${args.id}`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(updateBody),
      });
      if (!updateRes.ok) {
        const err = await updateRes.text();
        return `Error updating task: ${err}`;
      }

      // Return full task list for context
      const listRes = await fetch(`${getFernUrl()}/internal/tasks/list`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ threadId: args.threadId }),
      });
      if (!listRes.ok) {
        return `Task ${args.id} updated (could not fetch full list)`;
      }

      const tasks = (await listRes.json()) as Task[];
      return formatTaskList(tasks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error updating task: ${msg}`;
    }
  },
});
