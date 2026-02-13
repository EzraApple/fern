import {
  generateSubagentTaskId,
  getSubagentTaskById,
  insertSubagentTask,
  listSubagentTasks,
  updateSubagentTaskStatus,
} from "@/subagent/db.js";
import { spawnTask, waitForTask } from "@/subagent/executor.js";
import type { SubagentTask } from "@/subagent/types.js";
import { Hono } from "hono";
import { z } from "zod";

const SpawnSchema = z.object({
  agentType: z.enum(["explore", "research", "general"]),
  prompt: z.string().min(1),
  parentSessionId: z.string().min(1),
});

const CheckSchema = z.object({
  wait: z.boolean().default(true),
});

const ListSchema = z.object({
  parentSessionId: z.string().min(1),
});

// Timeout for blocking check requests (10 minutes)
const WAIT_TIMEOUT_MS = 600_000;

export function createSubagentApi(): Hono {
  const api = new Hono();

  // POST /spawn — create and immediately start a subagent task
  api.post("/spawn", async (c) => {
    const body = await c.req.json();
    const parsed = SpawnSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const { agentType, prompt, parentSessionId } = parsed.data;
    const now = new Date().toISOString();
    const task: SubagentTask = {
      id: generateSubagentTaskId(),
      agentType,
      status: "pending",
      prompt,
      parentSessionId,
      createdAt: now,
      updatedAt: now,
    };

    insertSubagentTask(task);
    spawnTask(task.id); // claim + enqueue (non-blocking)

    return c.json({ id: task.id, agentType, status: "running" });
  });

  // POST /check/:id — check task status, optionally blocking until done
  api.post("/check/:id", async (c) => {
    const id = c.req.param("id");
    const task = getSubagentTaskById(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = CheckSchema.safeParse(body);
    const wait = parsed.success ? parsed.data.wait : true;

    if (wait && (task.status === "pending" || task.status === "running")) {
      // Block until task reaches terminal state (with timeout)
      try {
        const completed = await Promise.race([
          waitForTask(id),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout waiting for task")), WAIT_TIMEOUT_MS)
          ),
        ]);
        return c.json(completed);
      } catch {
        // On timeout, return current state
        const current = getSubagentTaskById(id);
        if (current) return c.json(current);
        return c.json({ error: "Task not found after wait" }, 404);
      }
    }

    return c.json(task);
  });

  // POST /cancel/:id — cancel a pending or running task
  api.post("/cancel/:id", (c) => {
    const id = c.req.param("id");
    const task = getSubagentTaskById(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    if (task.status !== "pending" && task.status !== "running") {
      return c.json({ error: `Cannot cancel task with status: ${task.status}` }, 400);
    }
    updateSubagentTaskStatus(id, "cancelled");
    return c.json({ cancelled: true, id });
  });

  // POST /list — list tasks for a parent session
  api.post("/list", async (c) => {
    const body = await c.req.json();
    const parsed = ListSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid input", details: parsed.error.errors }, 400);
    }

    const tasks = listSubagentTasks(parsed.data.parentSessionId);
    return c.json(tasks);
  });

  return api;
}
