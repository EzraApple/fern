import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules BEFORE importing
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));
vi.mock("node:util", () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));
vi.mock("./workspace.js", () => ({
  updateWorkspaceBranch: vi.fn(),
}));
vi.mock("./github-service.js", () => ({
  getAuthenticatedCloneUrl: vi.fn(() =>
    Promise.resolve("https://x-access-token:mock-token@github.com/test/repo.git")
  ),
}));

import { execFile } from "node:child_process";
import type { WorkspaceInfo } from "../types/workspace.js";
import {
  commitChanges,
  createBranch,
  getCurrentBranch,
  hasUncommittedChanges,
  pushBranch,
} from "./workspace-git.js";
import { updateWorkspaceBranch } from "./workspace.js";

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function makeWorkspace(overrides?: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: "test-workspace-id",
    path: "/tmp/fern-workspaces/test-workspace",
    repoUrl: "https://github.com/test/repo.git",
    branch: "main",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("workspace-git", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createBranch", () => {
    it("should run git checkout -b with arg array and update workspace branch", async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });
      const workspace = makeWorkspace();

      await createBranch(workspace, "feature/new-thing");

      expect(mockExecFile).toHaveBeenCalledWith("git", ["checkout", "-b", "feature/new-thing"], {
        cwd: "/tmp/fern-workspaces/test-workspace",
      });
      expect(updateWorkspaceBranch).toHaveBeenCalledWith("test-workspace-id", "feature/new-thing");
    });

    it("should throw on git error", async () => {
      mockExecFile.mockRejectedValueOnce(new Error("branch already exists"));
      const workspace = makeWorkspace();

      await expect(createBranch(workspace, "existing-branch")).rejects.toThrow(
        "Failed to create branch"
      );
    });

    it("should rethrow non-Error exceptions from gitCmd", async () => {
      mockExecFile.mockRejectedValueOnce("string error");
      const workspace = makeWorkspace();

      await expect(createBranch(workspace, "some-branch")).rejects.toBe("string error");
    });

    it("should pass branch name as separate arg, not interpolated into a string", async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });
      const workspace = makeWorkspace();
      const malicious = "branch; rm -rf /";

      await createBranch(workspace, malicious);

      // The malicious string is passed as a single arg element, never shell-interpreted
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["checkout", "-b", "branch; rm -rf /"],
        expect.any(Object)
      );
    });
  });

  describe("commitChanges", () => {
    it("should stage, check status, configure user, and commit", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "" }) // git status --porcelain
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git config user.name
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git config user.email
        .mockResolvedValueOnce({
          stdout: "[feature-branch abc1234] Fix: something\n 1 file changed",
          stderr: "",
        }); // git commit

      const workspace = makeWorkspace();
      const commit = await commitChanges(workspace, "Fix: something");

      expect(commit.hash).toBe("abc1234");
      expect(commit.message).toBe("Fix: something");
      expect(commit.author).toBe("Fern");
      expect(typeof commit.timestamp).toBe("number");
    });

    it("should extract commit hash from various output formats", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // add
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "" }) // status
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // config name
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // config email
        .mockResolvedValueOnce({
          stdout: "[my-feature-branch deadbeef] Initial commit",
          stderr: "",
        });

      const workspace = makeWorkspace();
      const commit = await commitChanges(workspace, "Initial commit");

      expect(commit.hash).toBe("deadbeef");
    });

    it("should return 'unknown' hash when pattern does not match", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({
          stdout: "unexpected output format",
          stderr: "",
        });

      const workspace = makeWorkspace();
      const commit = await commitChanges(workspace, "some message");

      expect(commit.hash).toBe("unknown");
    });

    it("should throw when there are no changes to commit", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git add -A
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git status --porcelain (empty)

      const workspace = makeWorkspace();

      await expect(commitChanges(workspace, "No changes")).rejects.toThrow(
        "Failed to commit changes: No changes to commit"
      );
    });

    it("should pass commit message as separate arg without shell escaping", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({ stdout: "", stderr: "" })
        .mockResolvedValueOnce({
          stdout: '[main abc1234] Fix "quoted" stuff',
          stderr: "",
        });

      const workspace = makeWorkspace();
      await commitChanges(workspace, 'Fix "quoted" stuff');

      // Message is passed as a raw arg — no escaping needed with execFile
      const commitCall = mockExecFile.mock.calls[4] as unknown[];
      expect(commitCall[0]).toBe("git");
      expect(commitCall[1]).toEqual(["commit", "-m", 'Fix "quoted" stuff']);
    });

    it("should handle git config errors silently", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // add
        .mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "" }) // status
        .mockRejectedValueOnce(new Error("config error")) // config user.name fails
        .mockResolvedValueOnce({
          stdout: "[main abc1234] commit message",
          stderr: "",
        }); // commit still succeeds

      const workspace = makeWorkspace();
      const commit = await commitChanges(workspace, "commit message");
      expect(commit.hash).toBe("abc1234");
    });

    it("should rethrow non-Error exceptions", async () => {
      mockExecFile.mockRejectedValueOnce("raw string error");
      const workspace = makeWorkspace();

      await expect(commitChanges(workspace, "msg")).rejects.toBe("raw string error");
    });
  });

  describe("pushBranch", () => {
    it("should refresh remote URL and push to origin by default", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git remote set-url
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push
      const workspace = makeWorkspace({ branch: "feature-branch" });

      await pushBranch(workspace);

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        [
          "remote",
          "set-url",
          "origin",
          "https://x-access-token:mock-token@github.com/test/repo.git",
        ],
        { cwd: "/tmp/fern-workspaces/test-workspace" }
      );
      expect(mockExecFile).toHaveBeenCalledWith("git", ["push", "-u", "origin", "feature-branch"], {
        cwd: "/tmp/fern-workspaces/test-workspace",
      });
    });

    it("should push to specified remote", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git remote set-url
        .mockResolvedValueOnce({ stdout: "", stderr: "" }); // git push
      const workspace = makeWorkspace({ branch: "feature-branch" });

      await pushBranch(workspace, "upstream");

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["remote", "set-url", "upstream", expect.any(String)],
        { cwd: "/tmp/fern-workspaces/test-workspace" }
      );
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["push", "-u", "upstream", "feature-branch"],
        { cwd: "/tmp/fern-workspaces/test-workspace" }
      );
    });

    it("should throw on push failure", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git remote set-url
        .mockRejectedValueOnce(new Error("remote: Permission denied")); // git push
      const workspace = makeWorkspace({ branch: "feature-branch" });

      await expect(pushBranch(workspace)).rejects.toThrow("Failed to push branch");
    });

    it("should rethrow non-Error exceptions", async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: "", stderr: "" }) // git remote set-url
        .mockRejectedValueOnce(42); // git push
      const workspace = makeWorkspace({ branch: "feature-branch" });

      await expect(pushBranch(workspace)).rejects.toBe(42);
    });
  });

  describe("getCurrentBranch", () => {
    it("should return trimmed branch name", async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: "  feature/my-branch  \n",
        stderr: "",
      });

      const branch = await getCurrentBranch("/tmp/workspace");

      expect(branch).toBe("feature/my-branch");
      expect(mockExecFile).toHaveBeenCalledWith("git", ["branch", "--show-current"], {
        cwd: "/tmp/workspace",
      });
    });

    it("should return empty string when no branch (detached HEAD)", async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const branch = await getCurrentBranch("/tmp/workspace");

      expect(branch).toBe("");
    });

    it("should throw wrapped error on git command failure", async () => {
      mockExecFile.mockRejectedValueOnce(new Error("not a git repository"));

      await expect(getCurrentBranch("/tmp/workspace")).rejects.toThrow("Git command failed");
    });
  });

  describe("hasUncommittedChanges", () => {
    it("should return true when there are uncommitted changes", async () => {
      mockExecFile.mockResolvedValueOnce({
        stdout: "M src/index.ts\nA src/new-file.ts\n",
        stderr: "",
      });

      const result = await hasUncommittedChanges("/tmp/workspace");

      expect(result).toBe(true);
    });

    it("should return false when working tree is clean", async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: "", stderr: "" });

      const result = await hasUncommittedChanges("/tmp/workspace");

      expect(result).toBe(false);
    });

    it("should return false when stdout is only whitespace", async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: "   \n  ", stderr: "" });

      const result = await hasUncommittedChanges("/tmp/workspace");

      expect(result).toBe(false);
    });
  });
});
