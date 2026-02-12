import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ScheduledJob } from "@/scheduler/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testDbDir: string;
let testDbPath: string;

vi.mock("@/memory/config.js", () => ({
  getMemoryConfig: () => ({
    enabled: true,
    storagePath: testDbDir,
    chunkTokenThreshold: 25_000,
    chunkTokenMin: 15_000,
    chunkTokenMax: 40_000,
    summarizationModel: "gpt-4o-mini",
    maxSummaryTokens: 1024,
    embeddingModel: "text-embedding-3-small",
    dbPath: testDbPath,
  }),
}));

vi.mock("@/memory/embeddings.js", () => ({
  embedBatch: vi.fn().mockResolvedValue([]),
  embedText: vi.fn().mockResolvedValue([]),
}));

function makeJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  const now = new Date().toISOString();
  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: "one_shot",
    status: "pending",
    prompt: "Test prompt",
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

describe("scheduler db", () => {
  beforeEach(async () => {
    vi.resetModules();

    testDbDir = path.join(
      os.tmpdir(),
      `fern-test-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    testDbPath = path.join(testDbDir, "fern.db");
    fs.mkdirSync(testDbDir, { recursive: true });

    // Initialize the memory DB (which scheduler shares)
    const dbMod = await import("@/memory/db/index.js");
    await dbMod.initMemoryDb();

    // Create scheduler schema
    const schedulerDb = await import("./db.js");
    schedulerDb.createSchedulerSchema();
  });

  afterEach(async () => {
    const dbMod = await import("@/memory/db/index.js");
    dbMod.closeDb();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe("createSchedulerSchema", () => {
    it("creates the scheduled_jobs table", async () => {
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_jobs'")
        .all();
      expect(tables.length).toBe(1);
    });

    it("is idempotent", async () => {
      const schedulerDb = await import("./db.js");
      // Should not throw on second call
      schedulerDb.createSchedulerSchema();
    });
  });

  describe("insertJob / getJobById", () => {
    it("inserts and retrieves a job", async () => {
      const schedulerDb = await import("./db.js");
      const job = makeJob({ id: "job_test1", prompt: "Say hello" });
      schedulerDb.insertJob(job);

      const result = schedulerDb.getJobById("job_test1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("job_test1");
      expect(result?.prompt).toBe("Say hello");
      expect(result?.status).toBe("pending");
      expect(result?.type).toBe("one_shot");
    });

    it("returns null for non-existent job", async () => {
      const schedulerDb = await import("./db.js");
      expect(schedulerDb.getJobById("nonexistent")).toBeNull();
    });

    it("stores and retrieves metadata", async () => {
      const schedulerDb = await import("./db.js");
      const job = makeJob({ id: "job_meta", metadata: { prNumber: 42, origin: "whatsapp" } });
      schedulerDb.insertJob(job);

      const result = schedulerDb.getJobById("job_meta");
      expect(result?.metadata).toEqual({ prNumber: 42, origin: "whatsapp" });
    });

    it("stores recurring job with cron expression", async () => {
      const schedulerDb = await import("./db.js");
      const job = makeJob({
        id: "job_cron",
        type: "recurring",
        cronExpr: "0 9 * * 1-5",
      });
      schedulerDb.insertJob(job);

      const result = schedulerDb.getJobById("job_cron");
      expect(result?.type).toBe("recurring");
      expect(result?.cronExpr).toBe("0 9 * * 1-5");
    });
  });

  describe("getDueJobs", () => {
    it("returns jobs scheduled at or before now", async () => {
      const schedulerDb = await import("./db.js");
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();

      schedulerDb.insertJob(makeJob({ id: "job_past", scheduledAt: past }));
      schedulerDb.insertJob(makeJob({ id: "job_future", scheduledAt: future }));

      const now = new Date().toISOString();
      const due = schedulerDb.getDueJobs(now, 10);
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe("job_past");
    });

    it("only returns pending jobs", async () => {
      const schedulerDb = await import("./db.js");
      const past = new Date(Date.now() - 60_000).toISOString();

      schedulerDb.insertJob(makeJob({ id: "job_pending", scheduledAt: past }));
      schedulerDb.insertJob(makeJob({ id: "job_running", scheduledAt: past, status: "running" }));
      schedulerDb.insertJob(
        makeJob({ id: "job_completed", scheduledAt: past, status: "completed" })
      );

      const now = new Date().toISOString();
      const due = schedulerDb.getDueJobs(now, 10);
      expect(due.length).toBe(1);
      expect(due[0]?.id).toBe("job_pending");
    });

    it("respects limit", async () => {
      const schedulerDb = await import("./db.js");
      const past = new Date(Date.now() - 60_000).toISOString();

      for (let i = 0; i < 5; i++) {
        schedulerDb.insertJob(makeJob({ id: `job_${i}`, scheduledAt: past }));
      }

      const now = new Date().toISOString();
      const due = schedulerDb.getDueJobs(now, 2);
      expect(due.length).toBe(2);
    });

    it("orders by scheduled_at ASC", async () => {
      const schedulerDb = await import("./db.js");
      const t1 = new Date(Date.now() - 120_000).toISOString();
      const t2 = new Date(Date.now() - 60_000).toISOString();

      schedulerDb.insertJob(makeJob({ id: "job_later", scheduledAt: t2 }));
      schedulerDb.insertJob(makeJob({ id: "job_earlier", scheduledAt: t1 }));

      const now = new Date().toISOString();
      const due = schedulerDb.getDueJobs(now, 10);
      expect(due[0]?.id).toBe("job_earlier");
      expect(due[1]?.id).toBe("job_later");
    });
  });

  describe("updateJobStatus", () => {
    it("updates status", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_s1" }));
      schedulerDb.updateJobStatus("job_s1", "running");

      const result = schedulerDb.getJobById("job_s1");
      expect(result?.status).toBe("running");
    });

    it("updates status with additional fields", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_s2" }));
      schedulerDb.updateJobStatus("job_s2", "completed", {
        completedAt: new Date().toISOString(),
        lastRunResponse: "Done!",
      });

      const result = schedulerDb.getJobById("job_s2");
      expect(result?.status).toBe("completed");
      expect(result?.lastRunResponse).toBe("Done!");
      expect(result?.completedAt).toBeDefined();
    });

    it("stores error on failure", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_s3" }));
      schedulerDb.updateJobStatus("job_s3", "failed", {
        lastError: "Connection timeout",
      });

      const result = schedulerDb.getJobById("job_s3");
      expect(result?.status).toBe("failed");
      expect(result?.lastError).toBe("Connection timeout");
    });
  });

  describe("advanceRecurringJob", () => {
    it("resets status to pending with new scheduled_at", async () => {
      const schedulerDb = await import("./db.js");
      const job = makeJob({ id: "job_recur", type: "recurring", cronExpr: "0 9 * * *" });
      schedulerDb.insertJob(job);
      schedulerDb.updateJobStatus("job_recur", "running");

      const next = new Date(Date.now() + 86_400_000).toISOString();
      schedulerDb.advanceRecurringJob("job_recur", next);

      const result = schedulerDb.getJobById("job_recur");
      expect(result?.status).toBe("pending");
      expect(result?.scheduledAt).toBe(next);
      expect(result?.completedAt).toBeUndefined();
      expect(result?.lastError).toBeUndefined();
    });
  });

  describe("listJobs", () => {
    it("lists all jobs", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_l1" }));
      schedulerDb.insertJob(makeJob({ id: "job_l2" }));

      const all = schedulerDb.listJobs();
      expect(all.length).toBe(2);
    });

    it("filters by status", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_lp", status: "pending" }));
      schedulerDb.insertJob(makeJob({ id: "job_lc", status: "completed" }));

      const pending = schedulerDb.listJobs({ status: "pending" });
      expect(pending.length).toBe(1);
      expect(pending[0]?.id).toBe("job_lp");
    });

    it("respects limit", async () => {
      const schedulerDb = await import("./db.js");
      for (let i = 0; i < 5; i++) {
        schedulerDb.insertJob(makeJob({ id: `job_ll${i}` }));
      }

      const limited = schedulerDb.listJobs({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe("deleteJob", () => {
    it("deletes an existing job", async () => {
      const schedulerDb = await import("./db.js");
      schedulerDb.insertJob(makeJob({ id: "job_d1" }));

      const deleted = schedulerDb.deleteJob("job_d1");
      expect(deleted).toBe(true);
      expect(schedulerDb.getJobById("job_d1")).toBeNull();
    });

    it("returns false for non-existent job", async () => {
      const schedulerDb = await import("./db.js");
      expect(schedulerDb.deleteJob("nonexistent")).toBe(false);
    });
  });

  describe("generateJobId", () => {
    it("generates IDs with job_ prefix", async () => {
      const schedulerDb = await import("./db.js");
      const id = schedulerDb.generateJobId();
      expect(id).toMatch(/^job_/);
    });

    it("generates unique IDs", async () => {
      const schedulerDb = await import("./db.js");
      const ids = new Set(Array.from({ length: 100 }, () => schedulerDb.generateJobId()));
      expect(ids.size).toBe(100);
    });
  });
});
