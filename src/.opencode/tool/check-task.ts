import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

interface SubagentTaskResult {
  id: string;
  agentType: string;
  status: string;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export const check_task = tool({
  description: `Check on or wait for a spawned subagent task.

- wait=true (DEFAULT): Blocks until the task completes and returns the full result. Use when you're ready to consume the result.
- wait=false: Returns immediately with current status. Use to check progress without blocking.

Returns the full result text on completion, error message on failure, or current status if still running.`,
  args: {
    id: tool.schema.string().describe("Task ID returned by spawn_task"),
    wait: tool.schema
      .boolean()
      .optional()
      .describe("Block until completion (default: true). Set false to poll."),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/subagent/check/${args.id}`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ wait: args.wait ?? true }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error checking task: ${err}`;
      }
      const task = (await res.json()) as SubagentTaskResult;

      if (task.status === "completed" && task.result) {
        return `[${task.agentType}] Task ${task.id} completed:\n\n${task.result}`;
      }
      if (task.status === "failed") {
        return `[${task.agentType}] Task ${task.id} failed: ${task.error ?? "Unknown error"}`;
      }
      if (task.status === "cancelled") {
        return `[${task.agentType}] Task ${task.id} was cancelled.`;
      }
      // Still running or pending
      return `[${task.agentType}] Task ${task.id} is still ${task.status}.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error checking task: ${msg}`;
    }
  },
});
