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

export const schedule_list = tool({
  description:
    "List scheduled jobs. Filter by status to find what you need: 'pending' for upcoming jobs, 'running' for in-progress, 'failed' for debugging. Shows job IDs, types, next run times, and prompt previews.",
  args: {
    status: tool.schema
      .enum(["pending", "running", "completed", "failed", "cancelled"])
      .optional()
      .describe("Filter by job status (default: all)"),
    limit: tool.schema.number().optional().describe("Max results (default: 50)"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/scheduler/list`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          status: args.status,
          limit: args.limit,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error listing jobs: ${err}`;
      }
      const jobs = (await res.json()) as Array<{
        id: string;
        type: string;
        status: string;
        prompt: string;
        scheduledAt: string;
        cronExpr?: string;
      }>;
      if (jobs.length === 0) {
        return "No scheduled jobs found.";
      }
      return jobs
        .map(
          (j) =>
            `${j.id} [${j.type}/${j.status}] next: ${j.scheduledAt}${j.cronExpr ? ` cron: ${j.cronExpr}` : ""} — "${j.prompt.slice(0, 80)}${j.prompt.length > 80 ? "..." : ""}"`
        )
        .join("\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error listing jobs: ${msg}`;
    }
  },
});

export const schedule_cancel = tool({
  description:
    "Cancel a scheduled job by ID. Only jobs with 'pending' status can be cancelled — running jobs will complete. Use schedule_list first to find the job ID.",
  args: {
    jobId: tool.schema
      .string()
      .describe("The job ID to cancel (e.g., 'job_01ARZ3NDEKTSV4RRFFQ69G5FAV')"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/scheduler/cancel/${args.jobId}`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error cancelling job: ${err}`;
      }
      const result = (await res.json()) as { cancelled: boolean; id: string };
      return `Job ${result.id} cancelled.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error cancelling job: ${msg}`;
    }
  },
});
