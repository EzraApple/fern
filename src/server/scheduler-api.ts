import { CronExpressionParser } from "cron-parser";
import { Hono } from "hono";
import { z } from "zod";
import {
  generateJobId,
  getJobById,
  insertJob,
  listJobs,
  updateJobStatus,
} from "../scheduler/db.js";
import type { JobType, ScheduledJob } from "../scheduler/types.js";

const CreateJobSchema = z
  .object({
    prompt: z.string().min(1),
    scheduledAt: z.string().optional(),
    delayMs: z.number().positive().optional(),
    cronExpr: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => {
      const count = [data.scheduledAt, data.delayMs, data.cronExpr].filter(Boolean).length;
      return count === 1;
    },
    { message: "Exactly one of scheduledAt, delayMs, or cronExpr must be provided" }
  );

const ListJobsSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  limit: z.number().positive().optional(),
});

export function createSchedulerApi(): Hono {
  const api = new Hono();

  api.post("/create", async (c) => {
    const body = await c.req.json();
    const parsed = CreateJobSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const { prompt, scheduledAt, delayMs, cronExpr, metadata } = parsed.data;

    // Validate cron expression if provided
    if (cronExpr) {
      try {
        CronExpressionParser.parse(cronExpr);
      } catch {
        return c.json({ error: `Invalid cron expression: ${cronExpr}` }, 400);
      }
    }

    let resolvedScheduledAt: string;
    let type: JobType;

    if (scheduledAt) {
      resolvedScheduledAt = scheduledAt;
      type = "one_shot";
    } else if (delayMs) {
      resolvedScheduledAt = new Date(Date.now() + delayMs).toISOString();
      type = "one_shot";
    } else {
      // cronExpr
      const expr = CronExpressionParser.parse(cronExpr as string, { currentDate: new Date() });
      resolvedScheduledAt = expr.next().toDate().toISOString();
      type = "recurring";
    }

    const now = new Date().toISOString();
    const job: ScheduledJob = {
      id: generateJobId(),
      type,
      status: "pending",
      prompt,
      scheduledAt: resolvedScheduledAt,
      cronExpr: cronExpr ?? undefined,
      createdAt: now,
      updatedAt: now,
      metadata: metadata ?? {},
    };

    insertJob(job);
    return c.json(job);
  });

  api.post("/list", async (c) => {
    const body = await c.req.json();
    const parsed = ListJobsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const jobs = listJobs({
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    return c.json(jobs);
  });

  api.get("/get/:id", (c) => {
    const id = c.req.param("id");
    const job = getJobById(id);
    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }
    return c.json(job);
  });

  api.post("/cancel/:id", (c) => {
    const id = c.req.param("id");
    const job = getJobById(id);
    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }
    if (job.status !== "pending") {
      return c.json({ error: `Cannot cancel job with status: ${job.status}` }, 400);
    }
    updateJobStatus(id, "cancelled");
    return c.json({ cancelled: true, id });
  });

  return api;
}
