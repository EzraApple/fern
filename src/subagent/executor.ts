import { runAgentLoop } from "@/core/agent.js";
import { getSubagentConfig } from "@/subagent/config.js";
import { claimSubagentTask, getSubagentTaskById, updateSubagentTaskStatus } from "@/subagent/db.js";
import type { SubagentTask } from "@/subagent/types.js";
import PQueue from "p-queue";

// ── Execution Queue ───────────────────────────────────────────────────────

let executionQueue: PQueue | null = null;

function getExecutionQueue(): PQueue {
  if (!executionQueue) {
    const config = getSubagentConfig();
    executionQueue = new PQueue({ concurrency: config.maxConcurrentTasks });
  }
  return executionQueue;
}

export function stopExecutor(): void {
  executionQueue?.clear();
  executionQueue = null;

  // Reject all pending completion callbacks
  for (const [taskId, callbacks] of completionCallbacks.entries()) {
    callbacks.reject(new Error("Subagent executor shutting down"));
    completionCallbacks.delete(taskId);
  }
}

// ── Completion Callbacks ──────────────────────────────────────────────────
// Enables check_task(wait=true) to block until a task finishes.
// Mirrors sessionCompletionCallbacks pattern from src/core/opencode/session.ts

const completionCallbacks = new Map<
  string,
  { resolve: (task: SubagentTask) => void; reject: (err: Error) => void }
>();

/** Wait for a task to reach a terminal state. Resolves immediately if already done. */
export function waitForTask(taskId: string): Promise<SubagentTask> {
  // Check if already in terminal state
  const task = getSubagentTaskById(taskId);
  if (
    task &&
    (task.status === "completed" || task.status === "failed" || task.status === "cancelled")
  ) {
    return Promise.resolve(task);
  }

  return new Promise<SubagentTask>((resolve, reject) => {
    completionCallbacks.set(taskId, { resolve, reject });
  });
}

/** Signal task completion — resolves any waiting check_task call */
function signalTaskComplete(taskId: string): void {
  const callback = completionCallbacks.get(taskId);
  if (callback) {
    const task = getSubagentTaskById(taskId);
    if (task) {
      callback.resolve(task);
    } else {
      callback.reject(new Error(`Task ${taskId} not found after completion`));
    }
    completionCallbacks.delete(taskId);
  }
}

// ── Task Execution ────────────────────────────────────────────────────────

/** Claim a task and enqueue it for background execution. Returns immediately. */
export function spawnTask(taskId: string): void {
  const queue = getExecutionQueue();

  // Atomic claim: pending → running
  if (!claimSubagentTask(taskId)) {
    console.warn(`[Subagent] Failed to claim task ${taskId} (already claimed or cancelled)`);
    signalTaskComplete(taskId);
    return;
  }

  // Enqueue for execution (non-blocking)
  void queue.add(() => executeTask(taskId));
}

/** Execute a single subagent task via runAgentLoop */
async function executeTask(taskId: string): Promise<void> {
  const task = getSubagentTaskById(taskId);
  if (!task) {
    console.error(`[Subagent] Task ${taskId} not found for execution`);
    return;
  }

  console.info(
    `[Subagent] Executing ${task.agentType} task ${taskId}: "${task.prompt.slice(0, 60)}..."`
  );

  try {
    const result = await runAgentLoop({
      sessionId: `subagent_${taskId}`,
      message: task.prompt,
      channelName: "subagent",
      agentType: task.agentType,
    });

    // Re-check status — task may have been cancelled while running
    const current = getSubagentTaskById(taskId);
    if (current?.status === "cancelled") {
      console.info(`[Subagent] Task ${taskId} was cancelled during execution, skipping result`);
      return;
    }

    updateSubagentTaskStatus(taskId, "completed", {
      completedAt: new Date().toISOString(),
      result: result.response,
    });

    console.info(`[Subagent] Task ${taskId} completed`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Subagent] Task ${taskId} failed: ${msg}`);
    updateSubagentTaskStatus(taskId, "failed", { error: msg });
  } finally {
    signalTaskComplete(taskId);
  }
}
