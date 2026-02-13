import { cleanupOldSubagentTasks, createSubagentSchema, recoverStaleTasks } from "@/subagent/db.js";
import { stopExecutor } from "@/subagent/executor.js";

export function initSubagent(): void {
  createSubagentSchema();

  // Mark stale running tasks as failed (crash recovery — one-shot, non-retriable)
  const recovered = recoverStaleTasks();
  if (recovered > 0) {
    console.info(`[Subagent] Recovered ${recovered} stale running task(s) → failed`);
  }

  // Clean up old completed/failed/cancelled tasks
  const cleaned = cleanupOldSubagentTasks();
  if (cleaned > 0) {
    console.info(`[Subagent] Cleaned up ${cleaned} old task(s)`);
  }
}

export function stopSubagent(): void {
  stopExecutor();
}

export {
  createSubagentSchema,
  generateSubagentTaskId,
  getSubagentTaskById,
  insertSubagentTask,
  listSubagentTasks,
  updateSubagentTaskStatus,
} from "@/subagent/db.js";
export { getSubagentConfig } from "@/subagent/config.js";
export { spawnTask, waitForTask } from "@/subagent/executor.js";
export type {
  SpawnTaskInput,
  SubagentConfig,
  SubagentTask,
  SubagentTaskStatus,
  SubagentType,
} from "@/subagent/types.js";
