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

export const task_create = tool({
  description:
    "Create a task to track a step in multi-step work. Use when tackling complex requests with 3+ distinct steps. Keep titles short and imperative (e.g., 'Set up database schema'). Returns the full task list after creation so you have complete context.",
  args: {
    title: tool.schema.string().describe("Short imperative title (e.g., 'Write unit tests')"),
    description: tool.schema
      .string()
      .optional()
      .describe("Optional details or acceptance criteria"),
    threadId: tool.schema
      .string()
      .describe("Your session ID from the system prompt (e.g., 'whatsapp_+1234567890')"),
  },
  async execute(args) {
    try {
      const createRes = await fetch(`${getFernUrl()}/internal/tasks/create`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          threadId: args.threadId,
          title: args.title,
          description: args.description,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        return `Error creating task: ${err}`;
      }

      // Return full task list for context
      const listRes = await fetch(`${getFernUrl()}/internal/tasks/list`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ threadId: args.threadId }),
      });
      if (!listRes.ok) {
        const created = (await createRes.json()) as Task;
        return `Created: ${created.id} - ${created.title} (could not fetch full list)`;
      }

      const tasks = (await listRes.json()) as Task[];
      return formatTaskList(tasks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error creating task: ${msg}`;
    }
  },
});
