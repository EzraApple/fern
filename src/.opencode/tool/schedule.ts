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

export const schedule = tool({
  description:
    "Schedule a future task. The prompt you provide will be used to start a fresh agent session when the time comes — the agent can then use any tools (send_message, github_pr, memory_write, etc.) to fulfill the task. Provide exactly ONE of: scheduledAt, delayMs, or cronExpr.",
  args: {
    prompt: tool.schema
      .string()
      .describe(
        "Self-contained prompt for the future agent session. Include all context needed (phone numbers, repo names, etc.)"
      ),
    scheduledAt: tool.schema
      .string()
      .optional()
      .describe("Absolute time in ISO 8601 (e.g., '2025-01-15T09:00:00Z')"),
    delayMs: tool.schema
      .number()
      .optional()
      .describe("Relative delay in milliseconds (e.g., 7200000 for 2 hours)"),
    cronExpr: tool.schema
      .string()
      .optional()
      .describe(
        "Cron expression for recurring jobs (e.g., '0 9 * * 1' for every Monday at 9am UTC)"
      ),
    metadata: tool.schema
      .object({})
      .passthrough()
      .optional()
      .describe("Optional metadata (e.g., { prNumber: 42 })"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/scheduler/create`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          prompt: args.prompt,
          scheduledAt: args.scheduledAt,
          delayMs: args.delayMs,
          cronExpr: args.cronExpr,
          metadata: args.metadata ?? {},
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error scheduling job: ${err}`;
      }
      const job = (await res.json()) as {
        id: string;
        type: string;
        scheduledAt: string;
      };
      return `Job scheduled: ${job.id} [${job.type}] next run: ${job.scheduledAt}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error scheduling job: ${msg}`;
    }
  },
});
