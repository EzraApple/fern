import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/scheduler/db.js", () => ({
  generateJobId: vi.fn().mockReturnValue("job_TEST123"),
  insertJob: vi.fn(),
  getJobById: vi.fn(),
  listJobs: vi.fn(),
  updateJobStatus: vi.fn(),
  deleteJob: vi.fn(),
}));

import { getJobById, insertJob, listJobs, updateJobStatus } from "@/scheduler/db.js";
import type { ScheduledJob } from "@/scheduler/types.js";
import { createSchedulerApi } from "@/server/scheduler-api.js";
import { Hono } from "hono";

const mockInsertJob = vi.mocked(insertJob);
const mockGetJobById = vi.mocked(getJobById);
const mockListJobs = vi.mocked(listJobs);
const mockUpdateJobStatus = vi.mocked(updateJobStatus);

describe("createSchedulerApi", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    const root = new Hono();
    root.route("/internal/scheduler", createSchedulerApi());
    app = root;
  });

  describe("POST /internal/scheduler/create", () => {
    it("creates a one-shot job with scheduledAt", async () => {
      const scheduledAt = new Date(Date.now() + 60_000).toISOString();
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Remind me to check email",
          scheduledAt,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ScheduledJob;
      expect(body.id).toBe("job_TEST123");
      expect(body.type).toBe("one_shot");
      expect(body.status).toBe("pending");
      expect(body.prompt).toBe("Remind me to check email");
      expect(body.scheduledAt).toBe(scheduledAt);
      expect(mockInsertJob).toHaveBeenCalledTimes(1);
    });

    it("creates a one-shot job with delayMs", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Check PR status",
          delayMs: 7200000,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ScheduledJob;
      expect(body.type).toBe("one_shot");
      expect(mockInsertJob).toHaveBeenCalledTimes(1);
    });

    it("creates a recurring job with cronExpr", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Weekly self-review",
          cronExpr: "0 9 * * 1",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ScheduledJob;
      expect(body.type).toBe("recurring");
      expect(body.cronExpr).toBe("0 9 * * 1");
      expect(mockInsertJob).toHaveBeenCalledTimes(1);
    });

    it("stores metadata", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Check PR",
          scheduledAt: new Date(Date.now() + 60_000).toISOString(),
          metadata: { prNumber: 42 },
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as ScheduledJob;
      expect(body.metadata).toEqual({ prNumber: 42 });
    });

    it("returns 400 when no scheduling option provided", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Missing schedule",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when multiple scheduling options provided", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Too many options",
          scheduledAt: new Date().toISOString(),
          delayMs: 1000,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty prompt", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "",
          delayMs: 1000,
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid cron expression", async () => {
      const res = await app.request("/internal/scheduler/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Bad cron",
          cronExpr: "not a cron",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect((body as { error: string }).error).toContain("Invalid cron");
    });
  });

  describe("POST /internal/scheduler/list", () => {
    it("lists all jobs", async () => {
      mockListJobs.mockReturnValue([]);
      const res = await app.request("/internal/scheduler/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      expect(mockListJobs).toHaveBeenCalledWith({
        status: undefined,
        limit: undefined,
      });
    });

    it("filters by status", async () => {
      mockListJobs.mockReturnValue([]);
      const res = await app.request("/internal/scheduler/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      });

      expect(res.status).toBe(200);
      expect(mockListJobs).toHaveBeenCalledWith({
        status: "pending",
        limit: undefined,
      });
    });
  });

  describe("GET /internal/scheduler/get/:id", () => {
    it("returns a job by ID", async () => {
      const job: ScheduledJob = {
        id: "job_123",
        type: "one_shot",
        status: "pending",
        prompt: "Test",
        scheduledAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };
      mockGetJobById.mockReturnValue(job);

      const res = await app.request("/internal/scheduler/get/job_123");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as ScheduledJob).id).toBe("job_123");
    });

    it("returns 404 for non-existent job", async () => {
      mockGetJobById.mockReturnValue(null);
      const res = await app.request("/internal/scheduler/get/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /internal/scheduler/cancel/:id", () => {
    it("cancels a pending job", async () => {
      const job: ScheduledJob = {
        id: "job_cancel",
        type: "one_shot",
        status: "pending",
        prompt: "Test",
        scheduledAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };
      mockGetJobById.mockReturnValue(job);

      const res = await app.request("/internal/scheduler/cancel/job_cancel", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as { cancelled: boolean }).cancelled).toBe(true);
      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_cancel", "cancelled");
    });

    it("returns 404 for non-existent job", async () => {
      mockGetJobById.mockReturnValue(null);
      const res = await app.request("/internal/scheduler/cancel/nonexistent", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when cancelling non-pending job", async () => {
      const job: ScheduledJob = {
        id: "job_running",
        type: "one_shot",
        status: "running",
        prompt: "Test",
        scheduledAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {},
      };
      mockGetJobById.mockReturnValue(job);

      const res = await app.request("/internal/scheduler/cancel/job_running", {
        method: "POST",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect((body as { error: string }).error).toContain("Cannot cancel");
    });
  });
});
