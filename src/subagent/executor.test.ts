import type { AgentResult } from "@/core/types.js";
import type { SubagentTask } from "@/subagent/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the agent loop
vi.mock("@/core/agent.js", () => ({
  runAgentLoop: vi.fn(),
}));

// Mock DB functions
vi.mock("@/subagent/db.js", () => ({
  claimSubagentTask: vi.fn(),
  getSubagentTaskById: vi.fn(),
  updateSubagentTaskStatus: vi.fn(),
}));

// Mock config
vi.mock("@/subagent/config.js", () => ({
  getSubagentConfig: vi.fn().mockReturnValue({
    enabled: true,
    maxConcurrentTasks: 3,
  }),
}));

import { runAgentLoop } from "@/core/agent.js";
import { getSubagentConfig } from "@/subagent/config.js";
import { claimSubagentTask, getSubagentTaskById, updateSubagentTaskStatus } from "@/subagent/db.js";
import { spawnTask, stopExecutor, waitForTask } from "@/subagent/executor.js";

const mockRunAgentLoop = vi.mocked(runAgentLoop);
const mockClaimTask = vi.mocked(claimSubagentTask);
const mockGetTaskById = vi.mocked(getSubagentTaskById);
const mockUpdateStatus = vi.mocked(updateSubagentTaskStatus);
const mockGetConfig = vi.mocked(getSubagentConfig);

function makeTask(overrides?: Partial<SubagentTask>): SubagentTask {
  const now = new Date().toISOString();
  return {
    id: "sub_test",
    agentType: "explore",
    status: "pending",
    prompt: "Test prompt",
    parentSessionId: "parent_123",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const mockResult: AgentResult = {
  sessionId: "subagent_sub_test",
  response: "Found 3 files matching the pattern.",
  toolCalls: undefined,
};

describe("subagent executor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRunAgentLoop.mockResolvedValue(mockResult);
    mockClaimTask.mockReturnValue(true);
    mockGetConfig.mockReturnValue({ enabled: true, maxConcurrentTasks: 3 });
  });

  afterEach(() => {
    stopExecutor();
  });

  describe("spawnTask + executeTask", () => {
    it("claims and executes a task successfully", async () => {
      const task = makeTask({ id: "sub_exec1" });

      // Mock return chain:
      // 1. waitForTask initial check → not terminal, registers callback
      // 2. executeTask reads the task
      // 3. executeTask re-checks status before writing completed
      // 4. signalTaskComplete reads final state for callback
      mockGetTaskById
        .mockReturnValueOnce(task) // waitForTask initial check
        .mockReturnValueOnce(task) // executeTask reads the task
        .mockReturnValueOnce({ ...task, status: "running" }) // re-check before completing
        .mockReturnValueOnce({ ...task, status: "completed", result: mockResult.response }); // signalTaskComplete

      spawnTask("sub_exec1");

      const result = await waitForTask("sub_exec1");

      expect(mockClaimTask).toHaveBeenCalledWith("sub_exec1");
      expect(mockRunAgentLoop).toHaveBeenCalledWith({
        sessionId: "subagent_sub_exec1",
        message: "Test prompt",
        channelName: "subagent",
        agentType: "explore",
      });
      expect(mockUpdateStatus).toHaveBeenCalledWith("sub_exec1", "completed", {
        completedAt: expect.any(String),
        result: "Found 3 files matching the pattern.",
      });
      expect(result.status).toBe("completed");
    });

    it("marks task as failed on agent loop error", async () => {
      const task = makeTask({ id: "sub_fail" });

      mockGetTaskById
        .mockReturnValueOnce(task) // waitForTask initial check
        .mockReturnValueOnce(task) // executeTask reads the task
        .mockReturnValueOnce({ ...task, status: "failed", error: "LLM timeout" }); // signalTaskComplete

      mockRunAgentLoop.mockRejectedValue(new Error("LLM timeout"));

      spawnTask("sub_fail");

      const result = await waitForTask("sub_fail");

      expect(mockUpdateStatus).toHaveBeenCalledWith("sub_fail", "failed", {
        error: "LLM timeout",
      });
      expect(result.status).toBe("failed");
    });

    it("skips result write if task was cancelled during execution", async () => {
      const task = makeTask({ id: "sub_cancel_race" });

      mockGetTaskById
        .mockReturnValueOnce(task) // waitForTask initial check
        .mockReturnValueOnce(task) // executeTask reads the task
        .mockReturnValueOnce({ ...task, status: "cancelled" }) // re-check shows cancelled
        .mockReturnValueOnce({ ...task, status: "cancelled" }); // signalTaskComplete

      spawnTask("sub_cancel_race");

      const result = await waitForTask("sub_cancel_race");

      // Should NOT have been called with "completed"
      expect(mockUpdateStatus).not.toHaveBeenCalledWith(
        "sub_cancel_race",
        "completed",
        expect.anything()
      );
      expect(result.status).toBe("cancelled");
    });

    it("does not execute if claim fails", async () => {
      mockClaimTask.mockReturnValue(false);

      spawnTask("sub_noclaim");

      // Give queue a tick to process
      await new Promise((r) => setTimeout(r, 10));

      expect(mockRunAgentLoop).not.toHaveBeenCalled();
    });
  });

  describe("waitForTask", () => {
    it("returns immediately if task is already completed", async () => {
      const completedTask = makeTask({ id: "sub_done", status: "completed", result: "Done" });
      mockGetTaskById.mockReturnValue(completedTask);

      const result = await waitForTask("sub_done");

      expect(result.status).toBe("completed");
      expect(result.result).toBe("Done");
    });

    it("returns immediately if task is already failed", async () => {
      const failedTask = makeTask({ id: "sub_failed", status: "failed", error: "Oops" });
      mockGetTaskById.mockReturnValue(failedTask);

      const result = await waitForTask("sub_failed");

      expect(result.status).toBe("failed");
    });

    it("returns immediately if task is already cancelled", async () => {
      const cancelledTask = makeTask({ id: "sub_cancelled", status: "cancelled" });
      mockGetTaskById.mockReturnValue(cancelledTask);

      const result = await waitForTask("sub_cancelled");

      expect(result.status).toBe("cancelled");
    });
  });

  describe("stopExecutor", () => {
    it("rejects pending callbacks on shutdown", async () => {
      // Set up a task that's still running so waitForTask registers a callback
      mockGetTaskById.mockReturnValue(makeTask({ id: "sub_shutdown", status: "running" }));

      const waitPromise = waitForTask("sub_shutdown");

      stopExecutor();

      await expect(waitPromise).rejects.toThrow("Subagent executor shutting down");
    });
  });

  describe("agent type routing", () => {
    it("passes research agent type to runAgentLoop", async () => {
      const task = makeTask({ id: "sub_research", agentType: "research", prompt: "Search docs" });

      mockGetTaskById
        .mockReturnValueOnce(task) // waitForTask initial check
        .mockReturnValueOnce(task) // executeTask reads
        .mockReturnValueOnce({ ...task, status: "running" }) // re-check
        .mockReturnValueOnce({ ...task, status: "completed", result: mockResult.response }); // signal

      spawnTask("sub_research");
      await waitForTask("sub_research");

      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "research",
          channelName: "subagent",
        })
      );
    });

    it("passes general agent type to runAgentLoop", async () => {
      const task = makeTask({ id: "sub_general", agentType: "general", prompt: "Fix bug" });

      mockGetTaskById
        .mockReturnValueOnce(task) // waitForTask initial check
        .mockReturnValueOnce(task) // executeTask reads
        .mockReturnValueOnce({ ...task, status: "running" }) // re-check
        .mockReturnValueOnce({ ...task, status: "completed", result: mockResult.response }); // signal

      spawnTask("sub_general");
      await waitForTask("sub_general");

      expect(mockRunAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "general",
          channelName: "subagent",
        })
      );
    });
  });
});
