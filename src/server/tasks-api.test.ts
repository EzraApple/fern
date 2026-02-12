import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/tasks/db.js", () => ({
  generateTaskId: vi.fn().mockReturnValue("task_TEST123"),
  insertTask: vi.fn(),
  getTaskById: vi.fn(),
  listTasksByThread: vi.fn(),
  updateTask: vi.fn(),
  getNextTask: vi.fn(),
}));

import { createTasksApi } from "@/server/tasks-api.js";
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

const mockInsertTask = vi.mocked(insertTask);
const mockGetTaskById = vi.mocked(getTaskById);
const mockListTasksByThread = vi.mocked(listTasksByThread);
const mockUpdateTask = vi.mocked(updateTask);
const mockGetNextTask = vi.mocked(getNextTask);
const mockGenerateTaskId = vi.mocked(generateTaskId);

function makeTask(overrides?: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: "task_TEST123",
    threadId: "test_thread",
    title: "Test task",
    status: "pending",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("createTasksApi", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTaskId.mockReturnValue("task_TEST123");
    const root = new Hono();
    root.route("/internal/tasks", createTasksApi());
    app = root;
  });

  describe("POST /internal/tasks/create", () => {
    it("creates a task with title and threadId", async () => {
      mockListTasksByThread.mockReturnValue([]);

      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "whatsapp_+1234567890",
          title: "Set up database",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task;
      expect(body.id).toBe("task_TEST123");
      expect(body.title).toBe("Set up database");
      expect(body.threadId).toBe("whatsapp_+1234567890");
      expect(body.status).toBe("pending");
      expect(mockInsertTask).toHaveBeenCalledTimes(1);
    });

    it("creates a task with description", async () => {
      mockListTasksByThread.mockReturnValue([]);

      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "test_thread",
          title: "Write tests",
          description: "Cover all CRUD operations",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task;
      expect(body.description).toBe("Cover all CRUD operations");
    });

    it("auto-assigns sort_order based on existing tasks", async () => {
      mockListTasksByThread.mockReturnValue([
        makeTask({ sortOrder: 0 }),
        makeTask({ sortOrder: 2 }),
      ]);

      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "test_thread",
          title: "Third task",
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task;
      expect(body.sortOrder).toBe(3);
    });

    it("uses explicit sort_order when provided", async () => {
      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "test_thread",
          title: "Custom order",
          sortOrder: 10,
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task;
      expect(body.sortOrder).toBe(10);
    });

    it("returns 400 for missing threadId", async () => {
      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "No thread",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing title", async () => {
      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "test_thread",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty title", async () => {
      const res = await app.request("/internal/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "test_thread",
          title: "",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /internal/tasks/list", () => {
    it("lists tasks for a thread", async () => {
      const tasks = [makeTask({ id: "task_1" }), makeTask({ id: "task_2" })];
      mockListTasksByThread.mockReturnValue(tasks);

      const res = await app.request("/internal/tasks/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "test_thread" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task[];
      expect(body.length).toBe(2);
      expect(mockListTasksByThread).toHaveBeenCalledWith("test_thread");
    });

    it("returns empty array for thread with no tasks", async () => {
      mockListTasksByThread.mockReturnValue([]);

      const res = await app.request("/internal/tasks/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "empty_thread" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Task[];
      expect(body).toEqual([]);
    });

    it("returns 400 for missing threadId", async () => {
      const res = await app.request("/internal/tasks/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /internal/tasks/update/:id", () => {
    it("updates task status and returns full list", async () => {
      const task = makeTask({ id: "task_u1" });
      const updatedTask = { ...task, status: "done" as const };
      mockGetTaskById.mockReturnValueOnce(task).mockReturnValueOnce(updatedTask);
      mockListTasksByThread.mockReturnValue([updatedTask]);

      const res = await app.request("/internal/tasks/update/task_u1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: Task; tasks: Task[] };
      expect(body.task.status).toBe("done");
      expect(body.tasks).toHaveLength(1);
      expect(mockUpdateTask).toHaveBeenCalledWith("task_u1", { status: "done" });
      expect(mockListTasksByThread).toHaveBeenCalledWith("test_thread");
    });

    it("updates task title", async () => {
      const task = makeTask({ id: "task_u2" });
      const updatedTask = { ...task, title: "Updated title" };
      mockGetTaskById.mockReturnValueOnce(task).mockReturnValueOnce(updatedTask);
      mockListTasksByThread.mockReturnValue([updatedTask]);

      const res = await app.request("/internal/tasks/update/task_u2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated title" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: Task; tasks: Task[] };
      expect(body.task.title).toBe("Updated title");
    });

    it("returns 404 for non-existent task", async () => {
      mockGetTaskById.mockReturnValue(null);

      const res = await app.request("/internal/tasks/update/nonexistent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid status", async () => {
      mockGetTaskById.mockReturnValue(makeTask());

      const res = await app.request("/internal/tasks/update/task_TEST123", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "invalid_status" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /internal/tasks/next", () => {
    it("returns the next task", async () => {
      const task = makeTask({ id: "task_next", title: "Next up" });
      mockGetNextTask.mockReturnValue(task);

      const res = await app.request("/internal/tasks/next?threadId=test_thread");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: Task };
      expect(body.task.id).toBe("task_next");
      expect(body.task.title).toBe("Next up");
      expect(mockGetNextTask).toHaveBeenCalledWith("test_thread");
    });

    it("returns null task when no tasks available", async () => {
      mockGetNextTask.mockReturnValue(null);

      const res = await app.request("/internal/tasks/next?threadId=empty_thread");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: null };
      expect(body.task).toBeNull();
    });

    it("returns 400 when threadId is missing", async () => {
      const res = await app.request("/internal/tasks/next");

      expect(res.status).toBe(400);
    });
  });
});
