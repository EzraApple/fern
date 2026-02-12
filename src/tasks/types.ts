/** Status lifecycle: pending → in_progress → done | cancelled */
export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

/** A task in the database */
export interface Task {
  id: string;
  threadId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new task */
export interface CreateTaskInput {
  title: string;
  description?: string;
  sortOrder?: number;
}
