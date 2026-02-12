import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Task } from "@/tasks/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testDbDir: string;
let testDbPath: string;

vi.mock("@/memory/config.js", () => ({
  getMemoryConfig: () => ({
    enabled: true,
    storagePath: testDbDir,
    chunkTokenThreshold: 25_000,
    chunkTokenMin: 15_000,
    chunkTokenMax: 40_000,
    summarizationModel: "gpt-4o-mini",
    maxSummaryTokens: 1024,
    embeddingModel: "text-embedding-3-small",
    dbPath: testDbPath,
  }),
}));

vi.mock("@/memory/embeddings.js", () => ({
  embedBatch: vi.fn().mockResolvedValue([]),
  embedText: vi.fn().mockResolvedValue([]),
}));

function makeTask(overrides?: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    threadId: "test_thread",
    title: "Test task",
    status: "pending",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("tasks db", () => {
  beforeEach(async () => {
    vi.resetModules();

    testDbDir = path.join(
      os.tmpdir(),
      `fern-test-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    testDbPath = path.join(testDbDir, "fern.db");
    fs.mkdirSync(testDbDir, { recursive: true });

    const dbMod = await import("@/memory/db/index.js");
    await dbMod.initMemoryDb();

    const tasksDb = await import("./db.js");
    tasksDb.createTasksSchema();
  });

  afterEach(async () => {
    const dbMod = await import("@/memory/db/index.js");
    dbMod.closeDb();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe("createTasksSchema", () => {
    it("creates the tasks table", async () => {
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
        .all();
      expect(tables.length).toBe(1);
    });

    it("is idempotent", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.createTasksSchema();
    });
  });

  describe("insertTask / getTaskById", () => {
    it("inserts and retrieves a task", async () => {
      const tasksDb = await import("./db.js");
      const task = makeTask({ id: "task_test1", title: "Write tests" });
      tasksDb.insertTask(task);

      const result = tasksDb.getTaskById("task_test1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("task_test1");
      expect(result?.title).toBe("Write tests");
      expect(result?.status).toBe("pending");
      expect(result?.threadId).toBe("test_thread");
    });

    it("returns null for non-existent task", async () => {
      const tasksDb = await import("./db.js");
      expect(tasksDb.getTaskById("nonexistent")).toBeNull();
    });

    it("stores and retrieves description", async () => {
      const tasksDb = await import("./db.js");
      const task = makeTask({ id: "task_desc", description: "Detailed acceptance criteria" });
      tasksDb.insertTask(task);

      const result = tasksDb.getTaskById("task_desc");
      expect(result?.description).toBe("Detailed acceptance criteria");
    });

    it("handles missing description as undefined", async () => {
      const tasksDb = await import("./db.js");
      const task = makeTask({ id: "task_nodesc" });
      tasksDb.insertTask(task);

      const result = tasksDb.getTaskById("task_nodesc");
      expect(result?.description).toBeUndefined();
    });
  });

  describe("listTasksByThread", () => {
    it("returns tasks for the given thread only", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_a", threadId: "thread1" }));
      tasksDb.insertTask(makeTask({ id: "task_b", threadId: "thread2" }));
      tasksDb.insertTask(makeTask({ id: "task_c", threadId: "thread1" }));

      const thread1Tasks = tasksDb.listTasksByThread("thread1");
      expect(thread1Tasks.length).toBe(2);
      expect(thread1Tasks.every((t) => t.threadId === "thread1")).toBe(true);
    });

    it("returns empty array for thread with no tasks", async () => {
      const tasksDb = await import("./db.js");
      expect(tasksDb.listTasksByThread("empty_thread")).toEqual([]);
    });

    it("orders in_progress before pending", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_p", status: "pending", sortOrder: 0 }));
      tasksDb.insertTask(makeTask({ id: "task_ip", status: "in_progress", sortOrder: 1 }));

      const tasks = tasksDb.listTasksByThread("test_thread");
      expect(tasks[0]?.id).toBe("task_ip");
      expect(tasks[1]?.id).toBe("task_p");
    });

    it("orders pending by sort_order", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_s2", sortOrder: 2 }));
      tasksDb.insertTask(makeTask({ id: "task_s0", sortOrder: 0 }));
      tasksDb.insertTask(makeTask({ id: "task_s1", sortOrder: 1 }));

      const tasks = tasksDb.listTasksByThread("test_thread");
      expect(tasks[0]?.id).toBe("task_s0");
      expect(tasks[1]?.id).toBe("task_s1");
      expect(tasks[2]?.id).toBe("task_s2");
    });

    it("orders done after pending, cancelled last", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_cancelled", status: "cancelled" }));
      tasksDb.insertTask(makeTask({ id: "task_done", status: "done" }));
      tasksDb.insertTask(makeTask({ id: "task_pending", status: "pending" }));

      const tasks = tasksDb.listTasksByThread("test_thread");
      expect(tasks[0]?.id).toBe("task_pending");
      expect(tasks[1]?.id).toBe("task_done");
      expect(tasks[2]?.id).toBe("task_cancelled");
    });
  });

  describe("updateTask", () => {
    it("updates status", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_u1" }));
      tasksDb.updateTask("task_u1", { status: "in_progress" });

      const result = tasksDb.getTaskById("task_u1");
      expect(result?.status).toBe("in_progress");
    });

    it("updates title", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_u2", title: "Old title" }));
      tasksDb.updateTask("task_u2", { title: "New title" });

      const result = tasksDb.getTaskById("task_u2");
      expect(result?.title).toBe("New title");
    });

    it("updates description", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_u3" }));
      tasksDb.updateTask("task_u3", { description: "Added details" });

      const result = tasksDb.getTaskById("task_u3");
      expect(result?.description).toBe("Added details");
    });

    it("updates sortOrder", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_u4", sortOrder: 0 }));
      tasksDb.updateTask("task_u4", { sortOrder: 5 });

      const result = tasksDb.getTaskById("task_u4");
      expect(result?.sortOrder).toBe(5);
    });

    it("sets updated_at automatically", async () => {
      const tasksDb = await import("./db.js");
      const task = makeTask({ id: "task_u5" });
      tasksDb.insertTask(task);
      const before = tasksDb.getTaskById("task_u5")?.updatedAt;

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 10));
      tasksDb.updateTask("task_u5", { status: "done" });
      const after = tasksDb.getTaskById("task_u5")?.updatedAt;

      expect(after).not.toBe(before);
    });

    it("updates multiple fields at once", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_u6", title: "Old", status: "pending" }));
      tasksDb.updateTask("task_u6", { title: "New", status: "in_progress" });

      const result = tasksDb.getTaskById("task_u6");
      expect(result?.title).toBe("New");
      expect(result?.status).toBe("in_progress");
    });
  });

  describe("getNextTask", () => {
    it("returns in_progress task first", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_p", status: "pending", sortOrder: 0 }));
      tasksDb.insertTask(makeTask({ id: "task_ip", status: "in_progress", sortOrder: 1 }));

      const next = tasksDb.getNextTask("test_thread");
      expect(next?.id).toBe("task_ip");
    });

    it("returns first pending by sort_order when no in_progress", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_s2", sortOrder: 2 }));
      tasksDb.insertTask(makeTask({ id: "task_s0", sortOrder: 0 }));

      const next = tasksDb.getNextTask("test_thread");
      expect(next?.id).toBe("task_s0");
    });

    it("returns null when all tasks are done", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_d", status: "done" }));

      const next = tasksDb.getNextTask("test_thread");
      expect(next).toBeNull();
    });

    it("returns null for thread with no tasks", async () => {
      const tasksDb = await import("./db.js");
      expect(tasksDb.getNextTask("empty_thread")).toBeNull();
    });

    it("ignores cancelled tasks", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_c", status: "cancelled" }));
      tasksDb.insertTask(makeTask({ id: "task_p", status: "pending", sortOrder: 0 }));

      const next = tasksDb.getNextTask("test_thread");
      expect(next?.id).toBe("task_p");
    });
  });

  describe("cleanupOldTasks", () => {
    it("deletes old done tasks", async () => {
      const tasksDb = await import("./db.js");
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();

      // Insert a done task with old updated_at
      const task = makeTask({ id: "task_old", status: "done" });
      tasksDb.insertTask(task);
      db.prepare("UPDATE tasks SET updated_at = datetime('now', '-8 days') WHERE id = ?").run(
        "task_old"
      );

      const cleaned = tasksDb.cleanupOldTasks();
      expect(cleaned).toBe(1);
      expect(tasksDb.getTaskById("task_old")).toBeNull();
    });

    it("deletes old cancelled tasks", async () => {
      const tasksDb = await import("./db.js");
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();

      const task = makeTask({ id: "task_oldcancel", status: "cancelled" });
      tasksDb.insertTask(task);
      db.prepare("UPDATE tasks SET updated_at = datetime('now', '-8 days') WHERE id = ?").run(
        "task_oldcancel"
      );

      const cleaned = tasksDb.cleanupOldTasks();
      expect(cleaned).toBe(1);
    });

    it("does not delete recent done tasks", async () => {
      const tasksDb = await import("./db.js");
      tasksDb.insertTask(makeTask({ id: "task_recent", status: "done" }));

      const cleaned = tasksDb.cleanupOldTasks();
      expect(cleaned).toBe(0);
      expect(tasksDb.getTaskById("task_recent")).not.toBeNull();
    });

    it("does not delete pending or in_progress tasks", async () => {
      const tasksDb = await import("./db.js");
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();

      tasksDb.insertTask(makeTask({ id: "task_pending", status: "pending" }));
      tasksDb.insertTask(makeTask({ id: "task_ip", status: "in_progress" }));

      // Even if they're old
      db.prepare("UPDATE tasks SET updated_at = datetime('now', '-8 days') WHERE id IN (?, ?)").run(
        "task_pending",
        "task_ip"
      );

      const cleaned = tasksDb.cleanupOldTasks();
      expect(cleaned).toBe(0);
    });
  });

  describe("generateTaskId", () => {
    it("generates IDs with task_ prefix", async () => {
      const tasksDb = await import("./db.js");
      const id = tasksDb.generateTaskId();
      expect(id).toMatch(/^task_/);
    });

    it("generates unique IDs", async () => {
      const tasksDb = await import("./db.js");
      const ids = new Set(Array.from({ length: 100 }, () => tasksDb.generateTaskId()));
      expect(ids.size).toBe(100);
    });
  });
});
