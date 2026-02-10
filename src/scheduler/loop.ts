import { CronExpressionParser } from "cron-parser";
import PQueue from "p-queue";
import { runAgentLoop } from "../core/agent.js";
import { getSchedulerConfig } from "./config.js";
import { advanceRecurringJob, getDueJobs, updateJobStatus } from "./db.js";
import type { ScheduledJob } from "./types.js";

let timer: ReturnType<typeof setInterval> | null = null;
let executionQueue: PQueue | null = null;

export function startSchedulerLoop(): void {
  const config = getSchedulerConfig();
  if (!config.enabled) {
    console.info("[Scheduler] Disabled via config");
    return;
  }

  executionQueue = new PQueue({ concurrency: config.maxConcurrentJobs });

  timer = setInterval(() => {
    void tick().catch((err) => {
      console.error("[Scheduler] Tick error:", err);
    });
  }, config.pollIntervalMs);

  // Run first tick immediately to catch overdue jobs
  void tick().catch((err) => {
    console.error("[Scheduler] Initial tick error:", err);
  });

  console.info(`[Scheduler] Loop started (poll every ${config.pollIntervalMs}ms)`);
}

export function stopSchedulerLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  executionQueue?.clear();
  executionQueue = null;
  console.info("[Scheduler] Loop stopped");
}

/** Single tick: find due jobs and enqueue them for execution */
export async function tick(): Promise<void> {
  const config = getSchedulerConfig();
  const now = new Date().toISOString();

  const dueJobs = getDueJobs(now, config.maxConcurrentJobs);
  for (const job of dueJobs) {
    executionQueue?.add(() => executeJob(job));
  }
}

/** Execute a single scheduled job */
export async function executeJob(job: ScheduledJob): Promise<void> {
  console.info(`[Scheduler] Executing job ${job.id}: "${job.prompt.slice(0, 60)}..."`);

  updateJobStatus(job.id, "running");

  try {
    const result = await runAgentLoop({
      sessionId: `scheduler_${job.id}`,
      message: job.prompt,
      channelName: "scheduler",
    });

    if (job.type === "recurring" && job.cronExpr) {
      const expr = CronExpressionParser.parse(job.cronExpr, { currentDate: new Date() });
      const next = expr.next().toDate().toISOString();
      advanceRecurringJob(job.id, next);
      updateJobStatus(job.id, "pending", { lastRunResponse: result.response });
      console.info(`[Scheduler] Recurring job ${job.id} rescheduled for ${next}`);
    } else {
      updateJobStatus(job.id, "completed", {
        completedAt: new Date().toISOString(),
        lastRunResponse: result.response,
      });
      console.info(`[Scheduler] Job ${job.id} completed`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Job ${job.id} failed: ${msg}`);
    updateJobStatus(job.id, "failed", {
      lastError: msg,
    });
  }
}
