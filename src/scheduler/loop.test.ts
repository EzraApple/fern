import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentResult } from "../core/types.js";
import type { ScheduledJob } from "./types.js";

// Mock the agent loop
vi.mock("../core/agent.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock DB functions
vi.mock("./db.js", () => ({
  getDueJobs: vi.fn(),
  updateJobStatus: vi.fn(),
  advanceRecurringJob: vi.fn(),
}));

// Mock config
vi.mock("./config.js", () => ({
  getSchedulerConfig: vi.fn().mockReturnValue({
    enabled: true,
    pollIntervalMs: 60_000,
    maxConcurrentJobs: 3,
  }),
}));

import { runAgentLoop } from "../core/agent.js";
import { getSchedulerConfig } from "./config.js";
import { advanceRecurringJob, getDueJobs, updateJobStatus } from "./db.js";
import { executeJob, startSchedulerLoop, stopSchedulerLoop, tick } from "./loop.js";

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockGetDueJobs = vi.mocked(getDueJobs);
const mockUpdateJobStatus = vi.mocked(updateJobStatus);
const mockAdvanceRecurringJob = vi.mocked(advanceRecurringJob);
const mockGetConfig = vi.mocked(getSchedulerConfig);

function makeJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  const now = new Date().toISOString();
  return {
    id: "job_test",
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

const mockResult: AgentResult = {
  sessionId: "scheduler_job_test",
  response: "Done!",
  toolCalls: undefined,
};

describe("scheduler loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockRunAgentLoop.mockResolvedValue(mockResult);
    mockGetDueJobs.mockReturnValue([]);
    mockGetConfig.mockReturnValue({
      enabled: true,
      pollIntervalMs: 60_000,
      maxConcurrentJobs: 3,
    });
  });

  afterEach(() => {
    stopSchedulerLoop();
    vi.useRealTimers();
  });

  describe("tick", () => {
    it("queries for due jobs", async () => {
      await tick();
      expect(mockGetDueJobs).toHaveBeenCalledWith(expect.any(String), 3);
    });

    it("does not call executeJob when no jobs are due", async () => {
      mockGetDueJobs.mockReturnValue([]);
      await tick();
      expect(mockRunAgentLoop).not.toHaveBeenCalled();
    });
  });

  describe("executeJob", () => {
    it("marks job as running then completed for one-shot", async () => {
      const job = makeJob();
      await executeJob(job);

      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_test", "running");
      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_test", "completed", {
        completedAt: expect.any(String),
        lastRunResponse: "Done!",
      });
    });

    it("calls runAgentLoop with correct args", async () => {
      const job = makeJob({ prompt: "Send a reminder" });
      await executeJob(job);

      expect(mockRunAgentLoop).toHaveBeenCalledWith({
        sessionId: "scheduler_job_test",
        message: "Send a reminder",
        channelName: "scheduler",
      });
    });

    it("advances recurring jobs to next cron time", async () => {
      const job = makeJob({
        type: "recurring",
        cronExpr: "0 9 * * *", // Daily at 9am
      });
      await executeJob(job);

      expect(mockAdvanceRecurringJob).toHaveBeenCalledWith("job_test", expect.any(String));
      // Should also store the response
      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_test", "pending", {
        lastRunResponse: "Done!",
      });
    });

    it("marks job as failed on error", async () => {
      mockRunAgentLoop.mockRejectedValue(new Error("LLM timeout"));
      const job = makeJob();
      await executeJob(job);

      expect(mockUpdateJobStatus).toHaveBeenCalledWith("job_test", "failed", {
        lastError: "LLM timeout",
      });
    });
  });

  describe("startSchedulerLoop / stopSchedulerLoop", () => {
    it("does not start when disabled", () => {
      mockGetConfig.mockReturnValue({
        enabled: false,
        pollIntervalMs: 60_000,
        maxConcurrentJobs: 3,
      });
      startSchedulerLoop();
      // Advance time — tick should not be called
      vi.advanceTimersByTime(120_000);
      expect(mockGetDueJobs).not.toHaveBeenCalled();
    });

    it("runs first tick immediately on start", async () => {
      mockGetDueJobs.mockReturnValue([]);
      startSchedulerLoop();
      // Allow the immediate tick's promise to resolve
      await vi.advanceTimersByTimeAsync(0);
      expect(mockGetDueJobs).toHaveBeenCalledTimes(1);
    });

    it("runs tick on each interval", async () => {
      mockGetDueJobs.mockReturnValue([]);
      startSchedulerLoop();
      await vi.advanceTimersByTimeAsync(0); // immediate tick
      await vi.advanceTimersByTimeAsync(60_000); // first interval
      await vi.advanceTimersByTimeAsync(60_000); // second interval
      expect(mockGetDueJobs).toHaveBeenCalledTimes(3);
    });

    it("stops on stopSchedulerLoop", async () => {
      mockGetDueJobs.mockReturnValue([]);
      startSchedulerLoop();
      await vi.advanceTimersByTimeAsync(0);
      stopSchedulerLoop();
      await vi.advanceTimersByTimeAsync(120_000);
      // Only the initial tick should have run
      expect(mockGetDueJobs).toHaveBeenCalledTimes(1);
    });
  });
});
