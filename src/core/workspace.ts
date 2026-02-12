import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "@/config/config.js";
import { getAuthenticatedCloneUrl } from "@/core/github/auth.js";
import type { WorkspaceInfo } from "@/types/workspace.js";
import { ulid } from "ulid";

const execPromise = promisify(exec);

// Registry of active workspaces
const workspaceRegistry = new Map<string, WorkspaceInfo>();

/**
 * Get the base directory for workspaces
 */
function getWorkspaceBaseDir(): string {
  const config = loadConfig();
  return config.workspaces?.basePath || path.join(os.tmpdir(), "fern-workspaces");
}

/**
 * Create an isolated workspace by cloning a repository
 */
export async function createWorkspace(repoUrl: string): Promise<WorkspaceInfo> {
  const workspaceId = ulid();
  const baseDir = getWorkspaceBaseDir();
  const workspacePath = path.join(baseDir, workspaceId);

  console.info(`[Workspace] Creating workspace ${workspaceId} for ${repoUrl}`);

  try {
    // Create workspace directory
    fs.mkdirSync(workspacePath, { recursive: true });

    // Clone repository using GitHub App authentication
    console.info(`[Workspace] Cloning ${repoUrl} (via GitHub App)...`);
    const authenticatedUrl = await getAuthenticatedCloneUrl(repoUrl);
    const { stderr } = await execPromise(`git clone "${authenticatedUrl}" "${workspacePath}"`);

    if (stderr?.includes("fatal")) {
      throw new Error(`Git clone failed: ${stderr}`);
    }

    // Get current branch name
    const branchResult = await execPromise("git branch --show-current", {
      cwd: workspacePath,
    });
    const currentBranch = branchResult.stdout.trim();

    const workspace: WorkspaceInfo = {
      id: workspaceId,
      path: workspacePath,
      repoUrl,
      branch: currentBranch,
      createdAt: Date.now(),
    };

    // Register workspace
    workspaceRegistry.set(workspaceId, workspace);

    console.info(`[Workspace] Created workspace ${workspaceId} at ${workspacePath}`);

    return workspace;
  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    if (error instanceof Error) {
      console.error(`[Workspace] Failed to create workspace: ${error.message}`);
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get workspace by ID
 */
export function getWorkspaceById(id: string): WorkspaceInfo | null {
  return workspaceRegistry.get(id) || null;
}

/**
 * Get all active workspaces
 */
export function getAllWorkspaces(): WorkspaceInfo[] {
  return Array.from(workspaceRegistry.values());
}

/**
 * Clean up a specific workspace
 */
export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  console.info(`[Workspace] Cleaning up workspace at ${workspacePath}`);

  try {
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    // Remove from registry (find by path)
    for (const [id, workspace] of workspaceRegistry.entries()) {
      if (workspace.path === workspacePath) {
        workspaceRegistry.delete(id);
        break;
      }
    }

    console.info(`[Workspace] Cleaned up ${workspacePath}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Workspace] Failed to cleanup: ${error.message}`);
    }
    // Don't throw - cleanup is best effort
  }
}

/**
 * Clean up all active workspaces
 */
export function cleanupAllWorkspaces(): void {
  console.info(`[Workspace] Cleaning up ${workspaceRegistry.size} active workspaces...`);

  for (const workspace of workspaceRegistry.values()) {
    try {
      if (fs.existsSync(workspace.path)) {
        fs.rmSync(workspace.path, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(`[Workspace] Failed to cleanup ${workspace.id}:`, error);
    }
  }

  workspaceRegistry.clear();
  console.info("[Workspace] All workspaces cleaned up");
}

/**
 * Clean up stale workspaces (older than maxAgeMs)
 */
export function cleanupStaleWorkspaces(maxAgeMs: number): void {
  const baseDir = getWorkspaceBaseDir();

  // If base directory doesn't exist, nothing to clean up
  if (!fs.existsSync(baseDir)) {
    return;
  }

  console.info(`[Workspace] Checking for stale workspaces in ${baseDir}...`);

  const now = Date.now();
  let cleaned = 0;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workspacePath = path.join(baseDir, entry.name);

      // Check if workspace is in registry
      const inRegistry = Array.from(workspaceRegistry.values()).some(
        (w) => w.path === workspacePath
      );

      if (inRegistry) {
        // Check age from registry
        const workspace = Array.from(workspaceRegistry.values()).find(
          (w) => w.path === workspacePath
        );
        if (workspace && now - workspace.createdAt > maxAgeMs) {
          fs.rmSync(workspacePath, { recursive: true, force: true });
          workspaceRegistry.delete(workspace.id);
          cleaned++;
        }
      } else {
        // Not in registry - check file stats
        const stats = fs.statSync(workspacePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.rmSync(workspacePath, { recursive: true, force: true });
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.info(`[Workspace] Cleaned up ${cleaned} stale workspaces`);
    } else {
      console.info("[Workspace] No stale workspaces found");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Workspace] Error during stale cleanup: ${error.message}`);
    }
  }
}

/**
 * Update the branch name in workspace info
 */
export function updateWorkspaceBranch(workspaceId: string, branch: string): void {
  const workspace = workspaceRegistry.get(workspaceId);
  if (workspace) {
    workspace.branch = branch;
  }
}

// Setup process exit handlers to clean up workspaces
let cleanupRegistered = false;

export function registerCleanupHandlers(): void {
  if (cleanupRegistered) return;

  const cleanup = () => {
    cleanupAllWorkspaces();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  cleanupRegistered = true;
}
