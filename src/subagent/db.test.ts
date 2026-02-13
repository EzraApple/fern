import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentTask } from "@/subagent/types.js";
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

function makeTask(overrides?: Partial<SubagentTask>): SubagentTask {
  const now = new Date().toISOString();
  return {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agentType: "explore",
    status: "pending",
    prompt: "Test prompt",
    parentSessionId: "parent_123",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("subagent db", () => {
  beforeEach(async () => {
    vi.resetModules();

    testDbDir = path.join(
      os.tmpdir(),
      `fern-test-subagent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    testDbPath = path.join(testDbDir, "fern.db");
    fs.mkdirSync(testDbDir, { recursive: true });

    const dbMod = await import("@/memory/db/index.js");
    await dbMod.initMemoryDb();

    const subagentDb = await import("./db.js");
    subagentDb.createSubagentSchema();
  });

  afterEach(async () => {
    const dbMod = await import("@/memory/db/index.js");
    dbMod.closeDb();
    fs.rmSync(testDbDir, { recursive: true, force: true });
  });

  describe("createSubagentSchema", () => {
    it("creates the subagent_tasks table", async () => {
      const dbMod = await import("@/memory/db/index.js");
      const db = dbMod.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subagent_tasks'")
        .all();
      expect(tables.length).toBe(1);
    });

    it("is idempotent", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.createSubagentSchema();
    });
  });

  describe("insertSubagentTask / getSubagentTaskById", () => {
    it("inserts and retrieves a task", async () => {
      const subagentDb = await import("./db.js");
      const task = makeTask({ id: "sub_test1", prompt: "Find files" });
      subagentDb.insertSubagentTask(task);

      const result = subagentDb.getSubagentTaskById("sub_test1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("sub_test1");
      expect(result?.prompt).toBe("Find files");
      expect(result?.status).toBe("pending");
      expect(result?.agentType).toBe("explore");
    });

    it("returns null for non-existent task", async () => {
      const subagentDb = await import("./db.js");
      expect(subagentDb.getSubagentTaskById("nonexistent")).toBeNull();
    });

    it("converts null fields to undefined", async () => {
      const subagentDb = await import("./db.js");
      const task = makeTask({ id: "sub_nulls" });
      subagentDb.insertSubagentTask(task);

      const result = subagentDb.getSubagentTaskById("sub_nulls");
      expect(result?.completedAt).toBeUndefined();
      expect(result?.result).toBeUndefined();
      expect(result?.error).toBeUndefined();
    });

    it("stores all agent types", async () => {
      const subagentDb = await import("./db.js");
      for (const agentType of ["explore", "research", "general"] as const) {
        const task = makeTask({ id: `sub_${agentType}`, agentType });
        subagentDb.insertSubagentTask(task);

        const result = subagentDb.getSubagentTaskById(`sub_${agentType}`);
        expect(result?.agentType).toBe(agentType);
      }
    });
  });

  describe("updateSubagentTaskStatus", () => {
    it("updates status only", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_s1" }));
      subagentDb.updateSubagentTaskStatus("sub_s1", "running");

      const result = subagentDb.getSubagentTaskById("sub_s1");
      expect(result?.status).toBe("running");
    });

    it("updates status with result", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_s2" }));
      subagentDb.updateSubagentTaskStatus("sub_s2", "completed", {
        completedAt: new Date().toISOString(),
        result: "Found 3 files",
      });

      const result = subagentDb.getSubagentTaskById("sub_s2");
      expect(result?.status).toBe("completed");
      expect(result?.result).toBe("Found 3 files");
      expect(result?.completedAt).toBeDefined();
    });

    it("stores error on failure", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_s3" }));
      subagentDb.updateSubagentTaskStatus("sub_s3", "failed", {
        error: "LLM timeout",
      });

      const result = subagentDb.getSubagentTaskById("sub_s3");
      expect(result?.status).toBe("failed");
      expect(result?.error).toBe("LLM timeout");
    });
  });

  describe("claimSubagentTask", () => {
    it("claims a pending task", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_claim1" }));

      expect(subagentDb.claimSubagentTask("sub_claim1")).toBe(true);

      const result = subagentDb.getSubagentTaskById("sub_claim1");
      expect(result?.status).toBe("running");
    });

    it("fails to claim a non-pending task", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_claim2", status: "running" }));

      expect(subagentDb.claimSubagentTask("sub_claim2")).toBe(false);
    });

    it("prevents double claim", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_claim3" }));

      expect(subagentDb.claimSubagentTask("sub_claim3")).toBe(true);
      expect(subagentDb.claimSubagentTask("sub_claim3")).toBe(false);
    });

    it("fails for non-existent task", async () => {
      const subagentDb = await import("./db.js");
      expect(subagentDb.claimSubagentTask("nonexistent")).toBe(false);
    });
  });

  describe("listSubagentTasks", () => {
    it("lists tasks for a parent session", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_l1", parentSessionId: "parent_a" }));
      subagentDb.insertSubagentTask(makeTask({ id: "sub_l2", parentSessionId: "parent_a" }));
      subagentDb.insertSubagentTask(makeTask({ id: "sub_l3", parentSessionId: "parent_b" }));

      const tasksA = subagentDb.listSubagentTasks("parent_a");
      expect(tasksA.length).toBe(2);

      const tasksB = subagentDb.listSubagentTasks("parent_b");
      expect(tasksB.length).toBe(1);
    });

    it("returns empty array for unknown parent", async () => {
      const subagentDb = await import("./db.js");
      expect(subagentDb.listSubagentTasks("unknown")).toEqual([]);
    });
  });

  describe("recoverStaleTasks", () => {
    it("marks running tasks as failed", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_stale1", status: "running" }));
      subagentDb.insertSubagentTask(makeTask({ id: "sub_stale2", status: "running" }));
      subagentDb.insertSubagentTask(makeTask({ id: "sub_pending", status: "pending" }));

      const recovered = subagentDb.recoverStaleTasks();
      expect(recovered).toBe(2);

      const t1 = subagentDb.getSubagentTaskById("sub_stale1");
      expect(t1?.status).toBe("failed");
      expect(t1?.error).toBe("Process restarted during execution");

      const t2 = subagentDb.getSubagentTaskById("sub_stale2");
      expect(t2?.status).toBe("failed");

      // Pending should be untouched
      const tp = subagentDb.getSubagentTaskById("sub_pending");
      expect(tp?.status).toBe("pending");
    });

    it("returns 0 when no running tasks", async () => {
      const subagentDb = await import("./db.js");
      subagentDb.insertSubagentTask(makeTask({ id: "sub_pend", status: "pending" }));

      expect(subagentDb.recoverStaleTasks()).toBe(0);
    });
  });

  describe("cleanupOldSubagentTasks", () => {
    it("deletes old completed/failed/cancelled tasks", async () => {
      const subagentDb = await import("./db.js");
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago

      subagentDb.insertSubagentTask(
        makeTask({ id: "sub_old1", status: "completed", updatedAt: old })
      );
      subagentDb.insertSubagentTask(makeTask({ id: "sub_old2", status: "failed", updatedAt: old }));
      subagentDb.insertSubagentTask(
        makeTask({ id: "sub_recent", status: "completed" }) // Recent
      );

      const cleaned = subagentDb.cleanupOldSubagentTasks();
      expect(cleaned).toBe(2);
      expect(subagentDb.getSubagentTaskById("sub_old1")).toBeNull();
      expect(subagentDb.getSubagentTaskById("sub_old2")).toBeNull();
      expect(subagentDb.getSubagentTaskById("sub_recent")).not.toBeNull();
    });
  });

  describe("generateSubagentTaskId", () => {
    it("generates IDs with sub_ prefix", async () => {
      const subagentDb = await import("./db.js");
      const id = subagentDb.generateSubagentTaskId();
      expect(id).toMatch(/^sub_/);
    });

    it("generates unique IDs", async () => {
      const subagentDb = await import("./db.js");
      const ids = new Set(Array.from({ length: 100 }, () => subagentDb.generateSubagentTaskId()));
      expect(ids.size).toBe(100);
    });
  });
});
