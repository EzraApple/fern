import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

export const cancel_task = tool({
  description:
    "Cancel a spawned subagent task. Works on pending or running tasks. A running task may still complete in the background but its result will be discarded.",
  args: {
    id: tool.schema.string().describe("Task ID returned by spawn_task"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/subagent/cancel/${args.id}`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error cancelling task: ${err}`;
      }
      const result = (await res.json()) as { cancelled: boolean; id: string };
      return `Task ${result.id} cancelled.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error cancelling task: ${msg}`;
    }
  },
});
