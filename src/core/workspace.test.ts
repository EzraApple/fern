import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules BEFORE importing the module under test
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));
vi.mock("node:util", () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
  homedir: vi.fn(() => "/home/user"),
}));
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    ...actual,
    join: actual.join,
  };
});
vi.mock("ulid", () => ({
  ulid: vi.fn(() => "MOCK_ULID_001"),
}));
vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    workspaces: { basePath: "/tmp/fern-workspaces" },
  })),
}));
vi.mock("./github-service.js", () => ({
  getAuthenticatedCloneUrl: vi.fn((_url: string) =>
    Promise.resolve("https://x-access-token:mock-token@github.com/test/repo.git")
  ),
}));

import { exec } from "node:child_process";
import * as fs from "node:fs";
import { ulid } from "ulid";
import {
  cleanupAllWorkspaces,
  cleanupStaleWorkspaces,
  cleanupWorkspace,
  createWorkspace,
  getAllWorkspaces,
  getWorkspaceById,
  registerCleanupHandlers,
  updateWorkspaceBranch,
} from "./workspace.js";

const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
const mockUlid = ulid as unknown as ReturnType<typeof vi.fn>;

describe("workspace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset workspace registry by cleaning all workspaces
    cleanupAllWorkspaces();
  });

  describe("createWorkspace", () => {
    it("should clone repo and register workspace", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git clone
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" }); // git branch --show-current

      const workspace = await createWorkspace("https://github.com/test/repo.git");

      expect(workspace.id).toBe("MOCK_ULID_001");
      expect(workspace.path).toBe("/tmp/fern-workspaces/MOCK_ULID_001");
      expect(workspace.repoUrl).toBe("https://github.com/test/repo.git");
      expect(workspace.branch).toBe("main");
      expect(typeof workspace.createdAt).toBe("number");
      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/fern-workspaces/MOCK_ULID_001", {
        recursive: true,
      });
    });

    it("should register workspace in registry after creation", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

      await createWorkspace("https://github.com/test/repo.git");
      const found = getWorkspaceById("MOCK_ULID_001");

      expect(found).not.toBeNull();
      expect(found?.id).toBe("MOCK_ULID_001");
    });

    it("should throw and cleanup on fatal clone error", async () => {
      mockExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: repository not found",
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await expect(createWorkspace("https://github.com/test/nonexistent.git")).rejects.toThrow(
        "Failed to create workspace"
      );

      expect(fs.rmSync).toHaveBeenCalledWith("/tmp/fern-workspaces/MOCK_ULID_001", {
        recursive: true,
        force: true,
      });
    });

    it("should throw and cleanup on exec rejection", async () => {
      mockExec.mockRejectedValueOnce(new Error("Command failed"));
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await expect(createWorkspace("https://github.com/test/repo.git")).rejects.toThrow(
        "Failed to create workspace: Command failed"
      );

      expect(fs.rmSync).toHaveBeenCalled();
    });

    it("should not attempt cleanup if workspace dir does not exist on failure", async () => {
      mockExec.mockRejectedValueOnce(new Error("fail"));
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(createWorkspace("https://github.com/test/repo.git")).rejects.toThrow();

      expect(fs.rmSync).not.toHaveBeenCalled();
    });

    it("should rethrow non-Error exceptions", async () => {
      mockExec.mockRejectedValueOnce("string error");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(createWorkspace("https://github.com/test/repo.git")).rejects.toBe(
        "string error"
      );
    });

    it("should use unique ULID for each workspace", async () => {
      mockUlid.mockReturnValueOnce("ULID_A").mockReturnValueOnce("ULID_B");

      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "develop\n", stderr: "" });

      const ws1 = await createWorkspace("https://github.com/test/a.git");
      const ws2 = await createWorkspace("https://github.com/test/b.git");

      expect(ws1.id).toBe("ULID_A");
      expect(ws2.id).toBe("ULID_B");
    });
  });

  describe("getWorkspaceById", () => {
    it("should return null for non-existent workspace", () => {
      expect(getWorkspaceById("nonexistent")).toBeNull();
    });

    it("should return workspace by ID after creation", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

      await createWorkspace("https://github.com/test/repo.git");
      const workspace = getWorkspaceById("MOCK_ULID_001");

      expect(workspace).not.toBeNull();
      expect(workspace?.repoUrl).toBe("https://github.com/test/repo.git");
    });
  });

  describe("getAllWorkspaces", () => {
    it("should return empty array when no workspaces exist", () => {
      expect(getAllWorkspaces()).toEqual([]);
    });

    it("should return all created workspaces", async () => {
      mockUlid.mockReturnValueOnce("ID_1").mockReturnValueOnce("ID_2");
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

      await createWorkspace("https://github.com/test/a.git");
      await createWorkspace("https://github.com/test/b.git");

      const workspaces = getAllWorkspaces();
      expect(workspaces).toHaveLength(2);
    });
  });

  describe("cleanupWorkspace", () => {
    it("should remove workspace directory and deregister", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await createWorkspace("https://github.com/test/repo.git");
      expect(getWorkspaceById("MOCK_ULID_001")).not.toBeNull();

      await cleanupWorkspace("/tmp/fern-workspaces/MOCK_ULID_001");

      expect(fs.rmSync).toHaveBeenCalledWith("/tmp/fern-workspaces/MOCK_ULID_001", {
        recursive: true,
        force: true,
      });
      expect(getWorkspaceById("MOCK_ULID_001")).toBeNull();
    });

    it("should not throw if path does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(cleanupWorkspace("/tmp/nonexistent")).resolves.not.toThrow();
    });

    it("should not throw if rmSync throws (best effort cleanup)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      await expect(cleanupWorkspace("/tmp/fern-workspaces/some-path")).resolves.not.toThrow();
    });
  });

  describe("cleanupAllWorkspaces", () => {
    it("should cleanup all workspaces and clear registry", async () => {
      mockUlid.mockReturnValueOnce("ID_X").mockReturnValueOnce("ID_Y");
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await createWorkspace("https://github.com/test/a.git");
      await createWorkspace("https://github.com/test/b.git");

      expect(getAllWorkspaces()).toHaveLength(2);

      cleanupAllWorkspaces();

      expect(getAllWorkspaces()).toHaveLength(0);
      expect(fs.rmSync).toHaveBeenCalledTimes(2);
    });

    it("should handle rmSync errors gracefully", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("fail");
      });

      await createWorkspace("https://github.com/test/repo.git");

      expect(() => cleanupAllWorkspaces()).not.toThrow();
      expect(getAllWorkspaces()).toHaveLength(0);
    });
  });

  describe("cleanupStaleWorkspaces", () => {
    it("should skip if base directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      cleanupStaleWorkspaces(60_000);

      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it("should remove stale workspace from registry based on age", async () => {
      // Create a workspace
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

      await createWorkspace("https://github.com/test/repo.git");
      const workspace = getWorkspaceById("MOCK_ULID_001");
      expect(workspace).not.toBeNull();

      // Manually backdate the workspace so it appears stale
      workspace!.createdAt = Date.now() - 200_000;

      // Mock filesystem operations
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "MOCK_ULID_001", isDirectory: () => true } as unknown as ReturnType<
          typeof fs.readdirSync
        >[0],
      ]);

      expect(getAllWorkspaces()).toHaveLength(1);

      cleanupStaleWorkspaces(100_000);

      expect(fs.rmSync).toHaveBeenCalledWith("/tmp/fern-workspaces/MOCK_ULID_001", {
        recursive: true,
        force: true,
      });
      expect(getAllWorkspaces()).toHaveLength(0);
      expect(getWorkspaceById("MOCK_ULID_001")).toBeNull();
    });

    it("should remove stale directories not in registry based on file stats", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "old-workspace", isDirectory: () => true } as unknown as ReturnType<
          typeof fs.readdirSync
        >[0],
      ]);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 200_000,
      } as unknown as ReturnType<typeof fs.statSync>);

      cleanupStaleWorkspaces(100_000);

      expect(fs.rmSync).toHaveBeenCalledWith("/tmp/fern-workspaces/old-workspace", {
        recursive: true,
        force: true,
      });
    });

    it("should not remove fresh directories not in registry", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "fresh-workspace", isDirectory: () => true } as unknown as ReturnType<
          typeof fs.readdirSync
        >[0],
      ]);
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now(),
      } as unknown as ReturnType<typeof fs.statSync>);

      cleanupStaleWorkspaces(100_000);

      expect(fs.rmSync).not.toHaveBeenCalled();
    });

    it("should skip non-directory entries", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "file.txt", isDirectory: () => false } as unknown as ReturnType<
          typeof fs.readdirSync
        >[0],
      ]);

      cleanupStaleWorkspaces(1);

      expect(fs.rmSync).not.toHaveBeenCalled();
      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it("should handle errors during stale cleanup gracefully", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("read error");
      });

      expect(() => cleanupStaleWorkspaces(1)).not.toThrow();
    });
  });

  describe("updateWorkspaceBranch", () => {
    it("should update branch name for existing workspace", async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "main\n", stderr: "" });

      await createWorkspace("https://github.com/test/repo.git");
      updateWorkspaceBranch("MOCK_ULID_001", "feature-branch");

      const workspace = getWorkspaceById("MOCK_ULID_001");
      expect(workspace?.branch).toBe("feature-branch");
    });

    it("should do nothing for non-existent workspace", () => {
      expect(() => updateWorkspaceBranch("nonexistent", "branch")).not.toThrow();
    });
  });

  describe("registerCleanupHandlers", () => {
    it("should register process exit handlers", () => {
      const onSpy = vi.spyOn(process, "on");

      registerCleanupHandlers();

      expect(onSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

      onSpy.mockRestore();
    });

    it("should only register handlers once (idempotent)", () => {
      const onSpy = vi.spyOn(process, "on");

      // Note: registerCleanupHandlers uses a module-level flag, so it may
      // already be registered from the first call. The key behavior is that
      // calling it multiple times doesn't add duplicate handlers.
      const callCountBefore = onSpy.mock.calls.length;
      registerCleanupHandlers();
      registerCleanupHandlers();
      const callCountAfter = onSpy.mock.calls.length;

      // Should not have added more handlers on second call
      // (first call may or may not add depending on prior test state)
      expect(callCountAfter - callCountBefore).toBeLessThanOrEqual(3);

      onSpy.mockRestore();
    });
  });
});
