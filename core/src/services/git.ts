import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, writeFile, readFile as fsReadFile, mkdir } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { BlameInfo, BranchInfo, CommitInfo } from "@/types/index.js";
import { readFile } from "fs/promises";
import { logger } from "@/config/index.js";
import * as github from "@/services/integrations/github.js";

// Re-export getRepoForSentryProject from sentry service
;

const execAsync = promisify(exec);

// ============================================================================
// SSH Key Setup (for cloud execution)
// ============================================================================

let sshKeySetup = false;

/**
 * Setup SSH key from environment variable (for Trigger.dev cloud)
 */
async function setupSSHKey(): Promise<string | null> {
  if (sshKeySetup) return null;

  const sshKey = process.env.SSH_PRIVATE_KEY;
  if (!sshKey) {
    logger.info("[Git] No SSH_PRIVATE_KEY found, using gh CLI or GITHUB_TOKEN");
    return null;
  }

  const sshDir = join(homedir(), ".ssh");
  const keyPath = join(sshDir, "replee_agent");

  try {
    // Create .ssh directory if needed
    await mkdir(sshDir, { recursive: true, mode: 0o700 });

    // Write the key
    await writeFile(keyPath, sshKey + "\n", { mode: 0o600 });

    // Configure SSH to use this key for GitHub
    const configPath = join(sshDir, "config");
    const configContent = `
Host github.com
  IdentityFile ${keyPath}
  IdentitiesOnly yes
  StrictHostKeyChecking no
`;

    // Append if not already there
    let existingConfig = "";
    try {
      existingConfig = await fsReadFile(configPath, "utf-8");
    } catch {
      // File doesn't exist
    }

    if (!existingConfig.includes("replee_agent")) {
      await writeFile(configPath, existingConfig + configContent, { mode: 0o600 });
    }

    sshKeySetup = true;
    logger.info("[Git] SSH key configured at " + keyPath);
    return keyPath;
  } catch (error) {
    logger.error("[Git] Failed to setup SSH key:", error);
    return null;
  }
}

// ============================================================================
// Repository Setup (for cloud execution)
// ============================================================================

/**
 * Clone a repository from GitHub
 * Returns the path to the cloned repo
 */
async function cloneRepo(
  repoUrl: string,
  options?: {
    branch?: string;
    depth?: number;
    targetDir?: string;
  }
): Promise<string> {
  // Setup SSH key first (if available)
  await setupSSHKey();

  // Create temp directory if not specified
  const targetDir = options?.targetDir ?? await mkdtemp(join(tmpdir(), "replee-"));

  // Handle different URL formats
  let fullUrl = repoUrl;
  const isOwnerRepoFormat = !repoUrl.includes("://") && !repoUrl.startsWith("git@");

  if (isOwnerRepoFormat) {
    // Check if SSH key is available - prefer SSH for cloud execution
    if (process.env.SSH_PRIVATE_KEY) {
      fullUrl = `git@github.com:${repoUrl}.git`;
      logger.info(`[Git] Using SSH URL: ${fullUrl}`);
    } else {
      // Use GITHUB_TOKEN for HTTPS clone
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        fullUrl = `https://${token}@github.com/${repoUrl}.git`;
        logger.info(`[Git] Using HTTPS URL with token`);
      } else {
        fullUrl = `https://github.com/${repoUrl}.git`;
        logger.info(`[Git] Using public HTTPS URL`);
      }
    }
  }

  // Build clone command
  const args: string[] = ["clone"];

  if (options?.depth) {
    args.push("--depth", options.depth.toString());
  } else {
    args.push("--depth", "1"); // Default to shallow clone
  }

  if (options?.branch) {
    args.push("--branch", options.branch);
  }

  args.push(fullUrl, targetDir);

  logger.info(`[Git] Cloning ${repoUrl} to ${targetDir}...`);

  try {
    await execAsync(`git ${args.join(" ")}`, { timeout: 120000 }); // 2 min timeout
    logger.info(`[Git] Successfully cloned to ${targetDir}`);

    // Configure git user for commits
    await execAsync(`git -C "${targetDir}" config user.email "replee@replo.app"`);
    await execAsync(`git -C "${targetDir}" config user.name "Replee"`);

    return targetDir;
  } catch (error) {
    // Clean up on failure
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to clone repository: ${error}`);
  }
}

/**
 * Get or clone a repository
 *
 * @param repo - Repo in "owner/repo" format to clone
 */
async function getWorkingRepo(repo: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  logger.info(`Cloning repo: ${repo}`);
  const repoPath = await cloneRepo(repo, { depth: 100 });
  return {
    path: repoPath,
    cleanup: async () => {
      logger.info(`Cleaning up cloned repo at ${repoPath}`);
      await rm(repoPath, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * List all repos in the GitHub org
 */
async function listOrgRepos(): Promise<string[]> {
  const org = process.env.GITHUB_ORG;
  if (!org) {
    throw new Error("GITHUB_ORG not set");
  }

  try {
    return await github.listOrgRepos(org);
  } catch (error) {
    logger.error("Failed to list org repos:", error);
    return [];
  }
}

/**
 * Find a repo from a message by matching repo names
 * Returns the full "owner/repo" format or null if not found
 */
export async function findRepoFromMessage(message: string): Promise<string | null> {
  const org = process.env.GITHUB_ORG;
  if (!org) return null;

  const repos = await listOrgRepos();
  const messageLower = message.toLowerCase();

  // Try to find a repo name mentioned in the message
  for (const fullRepo of repos) {
    const repoName = fullRepo.split("/")[1].toLowerCase();

    // Check for exact match or common patterns
    if (
      messageLower.includes(repoName) ||
      messageLower.includes(repoName.replace(/-/g, " ")) ||
      messageLower.includes(repoName.replace(/_/g, " "))
    ) {
      logger.info(`Found repo match: ${fullRepo}`);
      return fullRepo;
    }
  }

  return null;
}

/**
 * Pull latest changes from remote
 */
async function pullLatest(repoPath: string): Promise<void> {
  try {
    await gitExec(repoPath, "fetch origin");
    const defaultBranch = await getDefaultBranch(repoPath);
    await gitExec(repoPath, `checkout ${defaultBranch}`);
    await gitExec(repoPath, `pull origin ${defaultBranch}`);
    logger.info(`Pulled latest changes on ${defaultBranch}`);
  } catch (error) {
    logger.warn(`Failed to pull latest: ${error}`);
  }
}

/**
 * Execute a git command in the specified repository
 */
async function gitExec(
  repoPath: string,
  command: string
): Promise<{ stdout: string; stderr: string }> {
  const fullCommand = `git -C "${repoPath}" ${command}`;
  logger.debug(`Executing: ${fullCommand}`);
  return execAsync(fullCommand);
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await gitExec(repoPath, "rev-parse --abbrev-ref HEAD");
  return stdout.trim();
}

/**
 * Get the default branch (main or master)
 */
async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await gitExec(
      repoPath,
      "symbolic-ref refs/remotes/origin/HEAD --short"
    );
    return stdout.trim().replace("origin/", "");
  } catch {
    // Fallback: check if main or master exists
    try {
      await gitExec(repoPath, "rev-parse --verify main");
      return "main";
    } catch {
      return "master";
    }
  }
}

/**
 * Create a new branch for the fix
 */
async function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch?: string
): Promise<BranchInfo> {
  const base = baseBranch ?? (await getDefaultBranch(repoPath));

  // Ensure we're on the base branch and up to date
  await gitExec(repoPath, `checkout ${base}`);
  await gitExec(repoPath, "pull --ff-only").catch(() => {
    // Ignore if pull fails (might be offline or no remote)
    logger.warn("Could not pull latest changes, continuing with local state");
  });

  // Check if branch already exists
  try {
    await gitExec(repoPath, `rev-parse --verify ${branchName}`);
    // Branch exists, checkout
    await gitExec(repoPath, `checkout ${branchName}`);
    return { name: branchName, isNew: false, baseBranch: base };
  } catch {
    // Branch doesn't exist, create it
    await gitExec(repoPath, `checkout -b ${branchName}`);
    return { name: branchName, isNew: true, baseBranch: base };
  }
}

/**
 * Get blame information for a specific file and line range
 */
async function getBlameInfo(
  repoPath: string,
  filePath: string,
  lineStart: number,
  lineEnd?: number
): Promise<BlameInfo[]> {
  const end = lineEnd ?? lineStart;
  const { stdout } = await gitExec(
    repoPath,
    `blame -L ${lineStart},${end} --porcelain "${filePath}"`
  );

  const blameInfos: BlameInfo[] = [];
  const lines = stdout.split("\n");
  let currentAuthor = "";
  let currentEmail = "";
  let currentTimestamp = "";

  for (const line of lines) {
    if (line.startsWith("author ")) {
      currentAuthor = line.replace("author ", "");
    } else if (line.startsWith("author-mail ")) {
      currentEmail = line.replace("author-mail ", "").replace(/[<>]/g, "");
    } else if (line.startsWith("author-time ")) {
      currentTimestamp = line.replace("author-time ", "");
    } else if (line.startsWith("filename ")) {
      blameInfos.push({
        name: currentAuthor,
        email: currentEmail,
        timestamp: new Date(parseInt(currentTimestamp) * 1000).toISOString(),
        lineRange: { start: lineStart, end },
      });
    }
  }

  return blameInfos;
}

/**
 * Get GitHub username from a commit author email
 */
async function getGitHubUsername(
  repoPath: string,
  email: string
): Promise<string | null> {
  try {
    // Check if email is a GitHub noreply email
    // Format: username@users.noreply.github.com or 12345+username@users.noreply.github.com
    const noreplyMatch = email.match(/(?:\d+\+)?([^@]+)@users\.noreply\.github\.com/i);
    if (noreplyMatch) {
      return noreplyMatch[1];
    }

    // Try to find the GitHub username from recent commits using Octokit
    const username = await github.searchCommitsByAuthorEmail(email);
    return username;
  } catch {
    return null;
  }
}

/**
 * Get the primary author (most recent modifier) for a file
 */
async function getPrimaryAuthor(
  repoPath: string,
  filePath: string
): Promise<BlameInfo | null> {
  try {
    const { stdout } = await gitExec(
      repoPath,
      `log -1 --format="%an|%ae|%at" -- "${filePath}"`
    );
    const [name, email, timestamp] = stdout.trim().split("|");
    if (!name || !email) return null;

    // Try to get GitHub username
    const githubUsername = await getGitHubUsername(repoPath, email);

    return {
      name,
      email,
      githubUsername: githubUsername ?? undefined,
      timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
      lineRange: { start: 0, end: 0 },
    };
  } catch {
    return null;
  }
}

/**
 * Stage all changes
 */
export async function stageAll(repoPath: string): Promise<void> {
  await gitExec(repoPath, "add -A");
}

/**
 * Stage specific files
 */
async function stageFiles(
  repoPath: string,
  files: string[]
): Promise<void> {
  const quotedFiles = files.map((f) => `"${f}"`).join(" ");
  await gitExec(repoPath, `add ${quotedFiles}`);
}

/**
 * Commit staged changes
 */
export async function commit(
  repoPath: string,
  message: string
): Promise<CommitInfo> {
  await gitExec(repoPath, `commit -m "${message.replace(/"/g, '\\"')}"`);

  const { stdout } = await gitExec(
    repoPath,
    'log -1 --format="%H|%s|%an|%at"'
  );
  const [hash, subject, author, timestamp] = stdout.trim().split("|");

  return {
    hash,
    message: subject,
    author,
    timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
  };
}

/**
 * Push the current branch to remote
 */
export async function push(
  repoPath: string,
  branchName: string,
  force = false
): Promise<void> {
  const forceFlag = force ? "--force-with-lease" : "";
  await gitExec(repoPath, `push ${forceFlag} -u origin ${branchName}`);
}

/**
 * Get the diff of staged changes
 */
async function getStagedDiff(repoPath: string): Promise<string> {
  const { stdout } = await gitExec(repoPath, "diff --cached");
  return stdout;
}

/**
 * Get the diff between current branch and base
 */
async function getDiffFromBase(
  repoPath: string,
  baseBranch?: string
): Promise<string> {
  const base = baseBranch ?? (await getDefaultBranch(repoPath));
  const { stdout } = await gitExec(repoPath, `diff ${base}...HEAD`);
  return stdout;
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  const { stdout } = await gitExec(repoPath, "status --porcelain");
  return stdout.trim().length > 0;
}

/**
 * Check if the current branch has commits that were pushed to remote
 */
async function hasPushedCommits(repoPath: string): Promise<boolean> {
  try {
    // Check if current branch has an upstream and if there are commits on remote
    const { stdout } = await gitExec(repoPath, "rev-parse --abbrev-ref HEAD");
    const branch = stdout.trim();

    // Check if branch has an upstream
    try {
      await gitExec(repoPath, `rev-parse --abbrev-ref ${branch}@{upstream}`);
      // If upstream exists, branch was pushed
      return true;
    } catch {
      // No upstream means not pushed
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Get recent commit history for context
 */
async function getRecentCommits(
  repoPath: string,
  count = 10
): Promise<CommitInfo[]> {
  const { stdout } = await gitExec(
    repoPath,
    `log -${count} --format="%H|%s|%an|%at"`
  );

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, message, author, timestamp] = line.split("|");
      return {
        hash,
        message,
        author,
        timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
      };
    });
}

/**
 * Get the git log for a specific file
 */
async function getFileHistory(
  repoPath: string,
  filePath: string,
  count = 5
): Promise<CommitInfo[]> {
  const { stdout } = await gitExec(
    repoPath,
    `log -${count} --format="%H|%s|%an|%at" -- "${filePath}"`
  );

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, message, author, timestamp] = line.split("|");
      return {
        hash,
        message,
        author,
        timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
      };
    });
}

/**
 * Reset any uncommitted changes
 */
async function resetChanges(repoPath: string): Promise<void> {
  await gitExec(repoPath, "checkout .");
  await gitExec(repoPath, "clean -fd");
}

/**
 * Checkout a specific branch
 */
export async function checkoutBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  await gitExec(repoPath, `checkout ${branchName}`);
}

// ============================================================================
// Repository Guidelines
// ============================================================================

/**
 * Read repository guidelines/coding standards
 * Looks for REPLEE.md or AGENTS.md in order
 */
async function readRepoGuidelines(
  repoPath: string
): Promise<string | null> {
  const guidelineFiles = ["REPLEE.md", "AGENTS.md"];

  for (const file of guidelineFiles) {
    try {
      const filePath = join(repoPath, file);
      const content = await readFile(filePath, "utf-8");
      logger.info(`[Git] Found repo guidelines in ${file}`);
      return content;
    } catch {
      // File doesn't exist, continue
    }
  }

  logger.debug("[Git] No repo guidelines found");
  return null;
}
