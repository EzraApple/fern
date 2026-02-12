import {
  generateTaskId,
  getNextTask,
  getTaskById,
  insertTask,
  listTasksByThread,
  updateTask,
} from "@/tasks/db.js";
import type { Task } from "@/tasks/types.js";
import { Hono } from "hono";
import { z } from "zod";

const CreateTaskSchema = z.object({
  threadId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
});

const ListTasksSchema = z.object({
  threadId: z.string().min(1),
});

const UpdateTaskSchema = z.object({
  status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  sortOrder: z.number().optional(),
});

export function createTasksApi(): Hono {
  const api = new Hono();

  api.post("/create", async (c) => {
    const body = await c.req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const { threadId, title, description, sortOrder } = parsed.data;

    // Auto-assign sort_order if not provided: max existing + 1
    let resolvedSortOrder = sortOrder;
    if (resolvedSortOrder === undefined) {
      const existing = listTasksByThread(threadId);
      resolvedSortOrder =
        existing.length > 0 ? Math.max(...existing.map((t) => t.sortOrder)) + 1 : 0;
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: generateTaskId(),
      threadId,
      title,
      description,
      status: "pending",
      sortOrder: resolvedSortOrder,
      createdAt: now,
      updatedAt: now,
    };

    insertTask(task);
    return c.json(task);
  });

  api.post("/list", async (c) => {
    const body = await c.req.json();
    const parsed = ListTasksSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const tasks = listTasksByThread(parsed.data.threadId);
    return c.json(tasks);
  });

  api.post("/update/:id", async (c) => {
    const id = c.req.param("id");
    const existing = getTaskById(id);
    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const body = await c.req.json();
    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    updateTask(id, parsed.data);
    const updated = getTaskById(id);
    // Return updated task + full list (infer threadId from task record)
    const tasks = listTasksByThread(existing.threadId);
    return c.json({ task: updated, tasks });
  });

  api.get("/next", (c) => {
    const threadId = c.req.query("threadId");
    if (!threadId) {
      return c.json({ error: "threadId query parameter required" }, 400);
    }

    const task = getNextTask(threadId);
    return c.json({ task: task ?? null });
  });

  return api;
}
