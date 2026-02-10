import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitCommit, WorkspaceInfo } from "../types/workspace.js";
import { getAuthenticatedCloneUrl } from "./github-service.js";
import { updateWorkspaceBranch } from "./workspace.js";

const execFilePromise = promisify(execFile);

/**
 * Execute a git command in the workspace directory using argv arrays (no shell).
 */
async function gitCmd(
  workspacePath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFilePromise("git", args, {
      cwd: workspacePath,
    });
    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Git command failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create a new branch in the workspace
 */
export async function createBranch(workspace: WorkspaceInfo, branchName: string): Promise<void> {
  console.info(`[Workspace] Creating branch ${branchName} in workspace ${workspace.id}`);

  try {
    await gitCmd(workspace.path, ["checkout", "-b", branchName]);
    updateWorkspaceBranch(workspace.id, branchName);

    console.info(`[Workspace] Created branch ${branchName}`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create branch: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Commit all changes in the workspace
 */
export async function commitChanges(workspace: WorkspaceInfo, message: string): Promise<GitCommit> {
  console.info(`[Workspace] Committing changes in workspace ${workspace.id}`);

  try {
    // Stage all changes
    await gitCmd(workspace.path, ["add", "-A"]);

    // Check if there are changes to commit
    const statusResult = await gitCmd(workspace.path, ["status", "--porcelain"]);
    if (!statusResult.stdout.trim()) {
      throw new Error("No changes to commit");
    }

    // Configure git user if not set (use Fern identity)
    try {
      await gitCmd(workspace.path, ["config", "user.name", "Fern"]);
      await gitCmd(workspace.path, ["config", "user.email", "fern@anthropic.com"]);
    } catch {
      // Ignore errors - user might already be configured
    }

    // Commit with message (passed as separate arg, no shell escaping needed)
    const commitResult = await gitCmd(workspace.path, ["commit", "-m", message]);

    // Extract commit hash
    const hashMatch = commitResult.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
    const hash = hashMatch?.[1] || "unknown";

    const commit: GitCommit = {
      hash,
      message,
      author: "Fern",
      timestamp: Date.now(),
    };

    console.info(`[Workspace] Committed changes: ${hash}`);

    return commit;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to commit changes: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Push the current branch to remote
 */
export async function pushBranch(workspace: WorkspaceInfo, remote = "origin"): Promise<void> {
  console.info(
    `[Workspace] Pushing branch ${workspace.branch} to ${remote} in workspace ${workspace.id}`
  );

  try {
    // Refresh remote URL with a fresh GitHub App token (tokens expire ~1hr)
    const freshUrl = await getAuthenticatedCloneUrl(workspace.repoUrl);
    await gitCmd(workspace.path, ["remote", "set-url", remote, freshUrl]);

    await gitCmd(workspace.path, ["push", "-u", remote, workspace.branch]);

    console.info(`[Workspace] Pushed branch ${workspace.branch}`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to push branch: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(workspacePath: string): Promise<string> {
  const result = await gitCmd(workspacePath, ["branch", "--show-current"]);
  return result.stdout?.trim() || "";
}

/**
 * Check if workspace has uncommitted changes
 */
export async function hasUncommittedChanges(workspacePath: string): Promise<boolean> {
  const result = await gitCmd(workspacePath, ["status", "--porcelain"]);
  return result.stdout.trim().length > 0;
}
