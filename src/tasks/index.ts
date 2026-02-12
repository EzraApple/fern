import { cleanupOldTasks, createTasksSchema } from "@/tasks/db.js";

export function initTasks(): void {
  createTasksSchema();
  const cleaned = cleanupOldTasks();
  if (cleaned > 0) {
    console.info(`  Cleaned up ${cleaned} old task(s)`);
  }
}

export {
  cleanupOldTasks,
  createTasksSchema,
  generateTaskId,
  getNextTask,
  getTaskById,
  insertTask,
  listTasksByThread,
  updateTask,
} from "@/tasks/db.js";
export type { CreateTaskInput, Task, TaskStatus } from "@/tasks/types.js";
