import { spawnSync, execSync } from "child_process";
import { rmSync, existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { GITHUB_SSH_HOST_KEYS, DEFAULT_GITHUB_ORG } from "@/constants/git.js";
import * as github from "@/services/integrations/github.js";
import { cacheGet, cacheSet } from "@/services/cache.js";

// Note (Kevin, 2026-01-06): Git operations service for OpenCode tools
// All business logic for workspace management, git commands, and PR operations

const GITHUB_ORG = process.env.GITHUB_ORG ?? DEFAULT_GITHUB_ORG;
const CACHE_DIR = join(homedir(), ".replee-cache", "repos");

/**
 * Get workspace base directory.
 * Note (Kevin, 2026-01-07): Using home directory for reliable PATH access.
 */
function getWorkspaceBase(): string {
  const homeWorkspace = join(homedir(), ".replee-workspaces");
  mkdirSync(homeWorkspace, { recursive: true });
  return homeWorkspace;
}

/**
 * Dangerous command patterns that are blocked in safe mode.
 */
const DANGEROUS_PATTERNS = [
  { pattern: /git\s+push\s+.*(-f|--force)/i, name: "force push" },
  { pattern: /git\s+push\s+--force/i, name: "force push" },
  { pattern: /git\s+reset\s+--hard/i, name: "hard reset" },
  { pattern: /git\s+rebase/i, name: "rebase" },
  { pattern: /git\s+branch\s+(-D|--delete\s+--force)/i, name: "force delete branch" },
  { pattern: /git\s+clean\s+-[a-z]*f/i, name: "clean with force" },
  { pattern: /rm\s+-rf?\s+\//i, name: "rm -rf on root" },
];

// ============================================================================
// Helper Functions
// ============================================================================

function getBotEmail(workspace: string): string | null {
  try {
    return execSync("git config user.email", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim() || null;
  } catch {
    return null;
  }
}

function getBranchCreatorEmail(workspace: string): string | null {
  try {
    return execSync(
      `git log --format='%ae' --reverse HEAD 2>/dev/null | head -1`,
      { cwd: workspace, encoding: "utf-8", timeout: 10000 }
    ).trim() || null;
  } catch {
    return null;
  }
}

function isOnBotCreatedBranch(workspace: string): boolean {
  const botEmail = getBotEmail(workspace);
  if (!botEmail) return true;
  const creatorEmail = getBranchCreatorEmail(workspace);
  if (!creatorEmail) return true;
  return botEmail.toLowerCase() === creatorEmail.toLowerCase();
}

function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const { pattern, name } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { dangerous: true, reason: name };
    }
  }
  return { dangerous: false };
}

function validateCommand(workspace: string, command: string): void {
  if (isOnBotCreatedBranch(workspace)) return;
  const { dangerous, reason } = isDangerousCommand(command);
  if (dangerous) {
    throw new Error(
      `BLOCKED: "${reason}" is not allowed on PRs you didn't create.\n` +
      `Create a new branch from the PR's branch and open a separate PR with your fixes.`
    );
  }
}

/**
 * Detect which package manager to use based on the repo's package.json
 * Note (Replee, 2026-01-08): Reads packageManager field from package.json first,
 * then falls back to lockfile detection, then to what's available in PATH
 */
function detectPackageManager(workspace: string): "pnpm" | "npm" | "bun" {
  // Note (Replee, 2026-01-09): First, check package.json for packageManager field
  const packageJsonPath = join(workspace, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      if (packageJson.packageManager) {
        // packageManager field is like "pnpm@10.17.1" or "bun@1.0.0"
        const pm = packageJson.packageManager.split("@")[0];
        if (pm === "pnpm" || pm === "bun" || pm === "npm") {
          console.log(`[git] Package manager: ${pm} (from package.json packageManager field)`);
          return pm;
        }
      }
    } catch {
      // Ignore parse errors, fall through to lockfile detection
    }
  }

  // Note (Replee, 2026-01-09): Check for lockfiles to infer package manager
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) {
    console.log("[git] Package manager: pnpm (detected pnpm-lock.yaml)");
    return "pnpm";
  }
  if (existsSync(join(workspace, "bun.lockb")) || existsSync(join(workspace, "bun.lock"))) {
    console.log("[git] Package manager: bun (detected bun lockfile)");
    return "bun";
  }
  if (existsSync(join(workspace, "package-lock.json"))) {
    console.log("[git] Package manager: npm (detected package-lock.json)");
    return "npm";
  }

  // Note (Replee, 2026-01-09): Default to pnpm since it's the project standard
  // Only fall back to npm if pnpm is not available in PATH
  const pnpmCheck = spawnSync("which", ["pnpm"], { encoding: "utf-8", timeout: 5000 });
  if (pnpmCheck.status === 0) {
    console.log(`[git] Package manager: pnpm (default, available at ${pnpmCheck.stdout.trim()})`);
    return "pnpm";
  }

  console.log("[git] Package manager: npm (fallback - pnpm not found in PATH)");
  return "npm";
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Setup SSH key from environment variable (for Trigger.dev cloud)
 */
export function setupSSHKey(): string | null {
  const sshKey = process.env.SSH_PRIVATE_KEY;
  if (!sshKey) return null;

  const sshDir = join(homedir(), ".ssh");
  const keyPath = join(sshDir, "replee_agent");
  const knownHostsPath = join(sshDir, "known_hosts");
  const configPath = join(sshDir, "config");

  try {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });

    const normalizedKey = sshKey.replace(/\\n/g, "\n").trim() + "\n";
    writeFileSync(keyPath, normalizedKey, { mode: 0o600 });

    const existingKnownHosts = existsSync(knownHostsPath) ? readFileSync(knownHostsPath, "utf-8") : "";
    if (!existingKnownHosts.includes("github.com")) {
      writeFileSync(knownHostsPath, existingKnownHosts + GITHUB_SSH_HOST_KEYS + "\n", { mode: 0o644 });
    }

    const configContent = `
Host github.com
  HostName github.com
  User git
  IdentityFile ${keyPath}
  IdentitiesOnly yes
  StrictHostKeyChecking no
`;
    const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
    if (!existingConfig.includes("replee_agent")) {
      writeFileSync(configPath, existingConfig + configContent, { mode: 0o600 });
    }

    process.env.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=${knownHostsPath}`;

    // Test SSH connection
    try {
      const sshTest = spawnSync("ssh", ["-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", `UserKnownHostsFile=${knownHostsPath}`, "-T", "git@github.com"], {
        encoding: "utf-8",
        timeout: 10000,
      });
      const authMatch = sshTest.stderr?.match(/Hi ([^!]+)!/);
      if (authMatch) {
        console.log(`[git] SSH key is tied to GitHub account: ${authMatch[1]}`);
      }
    } catch { /* non-fatal */ }

    return keyPath;
  } catch {
    return null;
  }
}

/**
 * Recursively find all AGENTS.md and REPLEE.md files in a workspace
 * Note (Replee, 2026-01-08): Searches up to 3 levels deep to find nested guideline files
 */
function findGuidelineFiles(dir: string, maxDepth = 3, currentDepth = 0): string[] {
  if (currentDepth > maxDepth) return [];
  
  const results: string[] = [];
  const guidelineNames = ["REPLEE.md", "AGENTS.md"];
  
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip node_modules, .git, and other common non-code directories
      if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build" || entry === ".next") {
        continue;
      }
      
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && guidelineNames.includes(entry)) {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          results.push(...findGuidelineFiles(fullPath, maxDepth, currentDepth + 1));
        }
      } catch { /* skip inaccessible entries */ }
    }
  } catch { /* skip inaccessible directories */ }
  
  return results;
}

/**
 * Read coding guidelines from a workspace (AGENTS.md or REPLEE.md)
 * Note (Replee, 2026-01-09): Only supports AGENTS.md and REPLEE.md files
 */
export function readCodingGuidelines(workspace: string): { filename: string; content: string } | null {
  // Only check REPLEE.md and AGENTS.md (REPLEE.md takes precedence)
  const guidelineFiles = ["REPLEE.md", "AGENTS.md"];
  for (const filename of guidelineFiles) {
    const filepath = join(workspace, filename);
    if (existsSync(filepath)) {
      try {
        return { filename, content: readFileSync(filepath, "utf-8") };
      } catch { /* continue */ }
    }
  }
  return null;
}

/**
 * Read all coding guidelines from a workspace, including nested AGENTS.md and REPLEE.md files
 * Returns combined content from root guidelines + nested guideline files
 */
export function readAllCodingGuidelines(workspace: string): { filename: string; content: string; allFiles: { path: string; content: string }[] } | null {
  // Get root-level guideline (CLAUDE.md or AGENTS.md)
  const rootGuideline = readCodingGuidelines(workspace);
  
  // Find all nested AGENTS.md and REPLEE.md files
  const nestedFiles = findGuidelineFiles(workspace);
  const allFiles: { path: string; content: string }[] = [];
  
  for (const filepath of nestedFiles) {
    // Skip root-level files (already handled by readCodingGuidelines)
    const relativePath = filepath.replace(workspace + "/", "");
    if (relativePath === "REPLEE.md" || relativePath === "AGENTS.md") continue;
    
    try {
      const content = readFileSync(filepath, "utf-8");
      // Only include if file has meaningful content (not just boilerplate)
      if (content.length > 50) {
        allFiles.push({ path: relativePath, content });
      }
    } catch { /* skip unreadable files */ }
  }
  
  if (!rootGuideline && allFiles.length === 0) {
    return null;
  }
  
  // Combine all guidelines into one response
  let combinedContent = rootGuideline?.content ?? "";
  
  if (allFiles.length > 0) {
    combinedContent += "\n\n---\n## Additional Guidelines from Subdirectories\n\n";
    for (const file of allFiles) {
      combinedContent += `### ${file.path}\n\n${file.content}\n\n`;
    }
  }
  
  return {
    filename: rootGuideline?.filename ?? "AGENTS.md (nested)",
    content: combinedContent,
    allFiles,
  };
}

/**
 * Clone repo and create a working branch
 */
export function setupWorkspace({ repo, branchName }: { repo: string; branchName: string }): {
  success: boolean;
  workspace?: string;
  repo?: string;
  branch?: string;
  message?: string;
  error?: string;
  codingGuidelines?: { filename: string; content: string; warning: string };
  packageManager?: "pnpm" | "npm" | "bun";
} {
  if (!repo) return { success: false, error: "No repository specified. Pass repo parameter (e.g., 'owner/repo')." };

  setupSSHKey();
  mkdirSync(CACHE_DIR, { recursive: true });

  const repoSlug = repo.replace("/", "-");
  const cachedRepo = join(CACHE_DIR, repoSlug);
  const workDir = join(getWorkspaceBase(), `${repoSlug}-${Date.now()}`);
  const sshUrl = `git@github.com:${repo}.git`;

  // Note (Kevin, 2026-01-07): Fast clone options:
  // --filter=blob:none = blobless clone (download blobs on-demand)
  // --single-branch = only fetch main branch
  // --no-tags = skip tags
  const cloneArgs = ["clone", "--filter=blob:none", "--single-branch", "--no-tags", sshUrl];

  if (existsSync(join(cachedRepo, ".git"))) {
    const fetchResult = spawnSync("git", ["fetch", "--depth", "1", "origin", "main"], { cwd: cachedRepo, encoding: "utf-8", timeout: 30000 });
    if (fetchResult.status === 0 && !fetchResult.signal) {
      spawnSync("git", ["reset", "--hard", "origin/main"], { cwd: cachedRepo, encoding: "utf-8", timeout: 10000 });
    }
    cpSync(cachedRepo, workDir, { recursive: true });
  } else {
    const cloneResult = spawnSync("git", [...cloneArgs, cachedRepo], { encoding: "utf-8", timeout: 60000 });
    if (cloneResult.status !== 0) {
      return { success: false, error: `Failed to clone ${repo}: ${cloneResult.stderr}` };
    }
    cpSync(cachedRepo, workDir, { recursive: true });
  }

  if (!existsSync(join(workDir, ".git"))) {
    return { success: false, error: "Clone failed - no .git directory" };
  }

  spawnSync("git", ["config", "user.email", "replee@replo.app"], { cwd: workDir, encoding: "utf-8" });
  spawnSync("git", ["config", "user.name", "Replee"], { cwd: workDir, encoding: "utf-8" });

  // Note (Kevin, 2026-01-07): Fetch the target branch from remote (may not exist for new branches)
  // This ensures we have the latest remote state since --single-branch only fetches main
  spawnSync("git", ["fetch", "origin", branchName], { cwd: workDir, encoding: "utf-8", timeout: 30000 });

  // Try to create new branch, or checkout existing
  // Note (Replee, 2026-01-08): Added timeouts to prevent hanging on local git operations
  const branchResult = spawnSync("git", ["checkout", "-b", branchName], { cwd: workDir, encoding: "utf-8", timeout: 10000 });
  if (branchResult.status !== 0) {
    // Branch exists - checkout and pull latest
    spawnSync("git", ["checkout", branchName], { cwd: workDir, encoding: "utf-8", timeout: 10000 });
    // Note (Kevin, 2026-01-07): Pull latest to ensure branch is up to date with remote
    spawnSync("git", ["pull", "origin", branchName, "--ff-only"], { cwd: workDir, encoding: "utf-8", timeout: 30000 });
  }

  // Note (Kevin, 2026-01-07): Removed auto-install - agent follows repo's AGENTS.md for setup
  // This prevents hangs from install prompts or postinstall scripts

  // Note (Replee, 2026-01-08): Use readAllCodingGuidelines to find nested AGENTS.md files
  const guidelines = readAllCodingGuidelines(workDir);
  const result: ReturnType<typeof setupWorkspace> = {
    success: true,
    workspace: workDir,
    repo,
    branch: branchName,
    message: `Workspace ready. Read AGENTS.md, README.md, and package.json for setup instructions.`,
  };

  if (guidelines) {
    const nestedCount = guidelines.allFiles.length;
    const nestedInfo = nestedCount > 0 ? ` (+ ${nestedCount} nested guideline files)` : "";
    result.codingGuidelines = {
      filename: guidelines.filename + nestedInfo,
      content: guidelines.content,
      warning: "⚠️ IMPORTANT: You MUST follow ALL patterns in this file. Do NOT ignore these rules.",
    };
  }

  // Note (Kevin, 2026-01-07): Include package manager in result for transparency
  // Note (Replee, 2026-01-09): Detect package manager from workspace after clone, default to pnpm
  result.packageManager = detectPackageManager(workDir);

  return result;
}

/**
 * Run a git command safely in the workspace
 */
export function runGitCommand(workspace: string, command: string): string {
  const fullCommand = command.startsWith("git ") ? command : `git ${command}`;
  validateCommand(workspace, fullCommand);
  return execSync(fullCommand, { cwd: workspace, encoding: "utf-8", stdio: "pipe", timeout: 30000 });
}

/**
 * Commit and push changes
 * Note (Yuxin, 2026-01-11, REPL-21958): Added coAuthor param for GitHub contribution tracking
 * Note (Replee, 2026-01-12, REPL-22016): Both Replee and requester are now co-authors for full attribution
 */
export function commitAndPush({ workspace, message, skipLint, coAuthor }: { workspace: string; message: string; skipLint?: boolean; coAuthor?: { name: string; email: string } }): {
  success: boolean;
  message: string;
  branch?: string;
  remoteUrl?: string;
  error?: string;
  lintOutput?: string;
} {
  runGitCommand(workspace, "add -A");

  const status = execSync("git status --porcelain", { cwd: workspace, encoding: "utf-8", timeout: 10000 });
  if (!status.trim()) {
    return { success: true, message: "No changes to commit" };
  }

  if (!skipLint && existsSync(join(workspace, "package.json"))) {
    const pm = detectPackageManager(workspace);
    const lintCmd = `${pm} run lint`;
    const lintFixCmd = `${pm} run lint --write`;

    try {
      execSync(lintCmd, { cwd: workspace, stdio: "pipe", encoding: "utf-8", timeout: 60000 });
    } catch {
      try {
        execSync(lintFixCmd, { cwd: workspace, stdio: "pipe", encoding: "utf-8", timeout: 60000 });
        runGitCommand(workspace, "add -A");
        execSync(lintCmd, { cwd: workspace, stdio: "pipe", encoding: "utf-8", timeout: 60000 });
      } catch (fixError) {
        const lintOutput = fixError instanceof Error ? (fixError as any).stderr || (fixError as any).stdout || fixError.message : String(fixError);
        return { success: false, message: "Lint failed", error: "Lint failed. Auto-fix was attempted but some errors remain.", lintOutput: lintOutput.slice(0, 2000) };
      }
    }
  }

  // Note (Replee, 2026-01-12, REPL-22016): Add Co-authored-by trailers for both Replee and requester
  // Replee is always a co-author (the AI that wrote the code)
  // The requester is also a co-author (gets green squares on their GitHub contribution graph)
  let commitMessage = message.replace(/"/g, '\\"');
  
  // Always add Replee as co-author
  commitMessage += `\n\nCo-authored-by: Replee <repleecodes@users.noreply.github.com>`;
  
  // Add requester as co-author if provided
  if (coAuthor?.name && coAuthor?.email) {
    commitMessage += `\nCo-authored-by: ${coAuthor.name} <${coAuthor.email}>`;
  }

  runGitCommand(workspace, `commit -m "${commitMessage}"`);
  runGitCommand(workspace, "push -u origin HEAD");

  const remoteUrl = execSync("git remote get-url origin", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();
  const branch = execSync("git branch --show-current", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();

  return { success: true, message: "Changes committed and pushed", branch, remoteUrl };
}

/**
 * Create a pull request using GitHub API
 */
export async function createPR({ workspace, title, body, draft }: { workspace: string; title: string; body: string; draft?: boolean }): Promise<{
  success: boolean;
  prUrl?: string;
  message: string;
}> {
  try {
    const branch = execSync("git branch --show-current", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();
    const pr = await github.createPR({ title, body, branch, draft }, workspace);
    return { success: true, prUrl: pr.htmlUrl, message: `Pull request created: ${pr.htmlUrl}` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to create PR: ${errorMsg}` };
  }
}

/**
 * Add a comment to the PR for the current branch
 * Note (Replee, 2026-01-10): Used to add @claude review comment after PR creation
 */
export async function addCommentToPR({ workspace, body }: { workspace: string; body: string }): Promise<void> {
  const branch = execSync("git branch --show-current", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();
  const remoteUrl = execSync("git remote get-url origin", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
  }
  const [, owner, repoName] = match;
  const repo = `${owner}/${repoName}`;

  // Find the PR for this branch
  const octokit = github.getOctokit();
  const { data: prs } = await octokit.rest.pulls.list({
    owner,
    repo: repoName,
    head: `${owner}:${branch}`,
    state: "open",
  });

  if (prs.length === 0) {
    throw new Error(`No open PR found for branch ${branch}`);
  }

  const prNumber = prs[0].number;
  await github.createIssueComment({ repo, issueNumber: prNumber, body });
}

/**
 * Clean up workspace
 */
export function cleanupWorkspace(workspace: string): { success: boolean; message: string } {
  rmSync(workspace, { recursive: true, force: true });
  return { success: true, message: `Workspace ${workspace} cleaned up` };
}

/**
 * Add reviewers to a PR based on file history (using GitHub API, no workspace needed)
 */
export async function addPRReviewers({ repo, prNumber, maxReviewers = 3 }: { repo: string; prNumber: number; maxReviewers?: number }): Promise<{
  success: boolean;
  message: string;
  reviewers?: string[];
  suggestedReviewers?: string[];
  filesAnalyzed?: number;
  prUrl?: string;
  error?: string;
}> {
  try {
    const octokit = github.getOctokit();
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      return { success: false, message: "Invalid repo format", error: "Expected owner/repo format" };
    }

    // Get PR details
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const prAuthor = pr.user?.login?.toLowerCase() ?? "";

    // Get files changed in PR
    const { data: prFiles } = await octokit.rest.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    const files = prFiles.map(f => f.filename);

    if (files.length === 0) {
      return { success: false, message: "No files found in PR", error: "No files found in PR" };
    }

    const contributorCounts = new Map<string, { count: number; name: string }>();

    // Check recent commits for each file
    for (const file of files.slice(0, 10)) {
      try {
        const { data: commits } = await octokit.rest.repos.listCommits({
          owner,
          repo: repoName,
          path: file,
          per_page: 5,
        });
        for (const commit of commits) {
          const login = commit.author?.login;
          if (!login || login.includes("[bot]")) continue;
          const key = login.toLowerCase();
          if (key === prAuthor) continue;
          const existing = contributorCounts.get(key);
          contributorCounts.set(key, { count: (existing?.count ?? 0) + 1, name: login });
        }
      } catch { /* ignore */ }
    }

    const reviewers = [...contributorCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, maxReviewers)
      .map(([, data]) => data.name);

    if (reviewers.length === 0) {
      return { success: true, message: "No suitable reviewers found based on file history", reviewers: [], filesAnalyzed: files.length };
    }

    try {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo: repoName,
        pull_number: prNumber,
        reviewers,
      });
      return {
        success: true,
        message: `Added ${reviewers.length} reviewer(s) to PR #${prNumber}`,
        reviewers,
        filesAnalyzed: files.length,
        prUrl: `https://github.com/${repo}/pull/${prNumber}`,
      };
    } catch (addError) {
      const errorOutput = addError instanceof Error ? addError.message : String(addError);
      return {
        success: false,
        message: `Couldn't add reviewers`,
        error: errorOutput.slice(0, 500),
        suggestedReviewers: reviewers,
        filesAnalyzed: files.length,
        prUrl: `https://github.com/${repo}/pull/${prNumber}`,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, message: "Failed to add reviewers", error: errorMsg };
  }
}

/**
 * Add reviewers to a PR based on file history (requires workspace)
 */
export async function addReviewersWithWorkspace({ workspace, prNumber, files, maxReviewers = 2 }: { workspace: string; prNumber: number; files: string[]; maxReviewers?: number }): Promise<{
  success: boolean;
  message: string;
  reviewers: string[];
}> {
  try {
    const octokit = github.getOctokit();
    let selfUsername = "";
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      selfUsername = user.login.toLowerCase();
    } catch { /* ignore */ }

    const contributorCounts = new Map<string, number>();

    for (const file of files) {
      try {
        const output = execSync(`git log -10 --format="%aE" -- "${file}"`, { cwd: workspace, encoding: "utf-8", timeout: 10000 });
        for (const email of output.trim().split("\n").filter(Boolean)) {
          if (email.includes("[bot]") || email.includes("noreply")) continue;
          const key = email.toLowerCase();
          contributorCounts.set(key, (contributorCounts.get(key) ?? 0) + 1);
        }
      } catch { /* ignore */ }
    }

    const sortedEmails = [...contributorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([email]) => email);
    const reviewers: string[] = [];

    for (const email of sortedEmails) {
      if (reviewers.length >= maxReviewers) break;
      try {
        const username = await github.searchUserByEmail(email);
        if (username && username.toLowerCase() !== selfUsername) {
          reviewers.push(username);
        }
      } catch { /* ignore */ }
    }

    if (reviewers.length === 0) {
      return { success: true, message: "No reviewers found based on file history", reviewers: [] };
    }

    // Get repo info from workspace
    const remoteUrl = execSync("git remote get-url origin", { cwd: workspace, encoding: "utf-8", timeout: 10000 }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      return { success: false, message: "Could not determine repo from workspace", reviewers: [] };
    }
    const [, owner, repoName] = match;

    await octokit.rest.pulls.requestReviewers({
      owner,
      repo: repoName,
      pull_number: prNumber,
      reviewers,
    });

    return { success: true, message: `Added ${reviewers.length} reviewer(s) to PR #${prNumber}`, reviewers };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Failed to add reviewers: ${errorMsg}`, reviewers: [] };
  }
}

/**
 * Checkout an existing PR's branch for editing
 */
export async function checkoutPR({ repo, prNumber }: { repo: string; prNumber: number }): Promise<{
  success: boolean;
  workspace?: string;
  repo?: string;
  branch?: string;
  prUrl?: string;
  message?: string;
  error?: string;
  codingGuidelines?: { filename: string; content: string; warning: string };
}> {
  if (!repo) return { success: false, error: "No repository specified. Pass repo parameter (e.g., 'owner/repo')." };

  setupSSHKey();
  mkdirSync(CACHE_DIR, { recursive: true });

  // Get PR details using GitHub API
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    return { success: false, error: "Invalid repo format. Expected 'owner/repo'." };
  }

  let prBranch: string;
  let prUrl: string;
  try {
    const octokit = github.getOctokit();
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });
    prBranch = pr.head.ref;
    prUrl = pr.html_url;
  } catch (error) {
    return { success: false, error: `Failed to get PR #${prNumber} details: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!prBranch) {
    return { success: false, error: `Could not find branch for PR #${prNumber}` };
  }

  const repoSlug = repo.replace("/", "-");
  const workDir = join(getWorkspaceBase(), `${repoSlug}-${Date.now()}`);
  const sshUrl = `git@github.com:${repo}.git`;

  // Note (Replee, 2026-01-08): Use shallow clone (--depth 1) for speed on large repos
  // We only need the PR branch content, not full history. Using --single-branch
  // to avoid fetching all branches upfront (we fetch the PR branch separately).
  const CLONE_TIMEOUT_MS = 120000; // 2 minutes for large repos
  const cloneResult = spawnSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--no-tags", "--single-branch", sshUrl, workDir], { encoding: "utf-8", timeout: CLONE_TIMEOUT_MS });
  if (cloneResult.status !== 0) {
    return { success: false, error: `Failed to clone ${repo}: ${cloneResult.stderr}` };
  }

  // Fetch the specific PR branch with --depth 1 for speed
  const fetchResult = spawnSync("git", ["fetch", "--depth", "1", "origin", prBranch], { cwd: workDir, encoding: "utf-8", timeout: 60000 });
  if (fetchResult.status !== 0) {
    return { success: false, error: `Failed to fetch branch ${prBranch}: ${fetchResult.stderr}` };
  }

  // Checkout the PR branch
  // Note (Replee, 2026-01-08): Added timeouts to prevent hanging on git checkout operations
  const checkoutResult = spawnSync("git", ["checkout", prBranch], { cwd: workDir, encoding: "utf-8", timeout: 10000 });
  if (checkoutResult.status !== 0 || checkoutResult.signal) {
    // Try creating a tracking branch
    const trackResult = spawnSync("git", ["checkout", "-b", prBranch, `origin/${prBranch}`], { cwd: workDir, encoding: "utf-8", timeout: 10000 });
    if (trackResult.status !== 0 || trackResult.signal) {
      const errorMsg = trackResult.signal
        ? `Checkout timed out (signal: ${trackResult.signal})`
        : `Failed to checkout branch ${prBranch}: ${checkoutResult.stderr}`;
      return { success: false, error: errorMsg };
    }
  }

  // Set up git config (local operations, short timeout)
  spawnSync("git", ["config", "user.email", "replee@replo.app"], { cwd: workDir, encoding: "utf-8", timeout: 5000 });
  spawnSync("git", ["config", "user.name", "Replee"], { cwd: workDir, encoding: "utf-8", timeout: 5000 });

  // Set upstream tracking
  spawnSync("git", ["branch", "--set-upstream-to", `origin/${prBranch}`], { cwd: workDir, encoding: "utf-8", timeout: 5000 });

  // Note (Replee, 2026-01-08): Install dependencies using the repo's package manager
  const detectedPm = detectPackageManager(workDir);
  const ciEnv = {
    ...process.env,
    CI: "true",
    npm_config_yes: "true",
    // Note (Kevin, 2026-01-07): Additional env vars to prevent prompts
    npm_config_loglevel: "error",
    DISABLE_OPENCOLLECTIVE: "true",
    ADBLOCK: "true",
    HUSKY: "0", // Disable husky hooks during install
  };

  // Note (Replee, 2026-01-08): Verify the detected package manager is available
  let actualPm: "pnpm" | "npm" | "bun" = detectedPm;
  const pmCheck = spawnSync("which", [detectedPm], { encoding: "utf-8", timeout: 5000 });
  if (pmCheck.status !== 0) {
    console.log(`[git] ${detectedPm} not found in PATH, falling back to npm`);
    actualPm = "npm";
  }

  // Note (Kevin, 2026-01-07): Reduced timeout from 5 min to 60s to prevent long hangs
  // Note (Replee, 2026-01-08): Further reduced and added proper timeout detection
  const CHECKOUT_INSTALL_TIMEOUT_MS = 60000;

  // Note (Replee, 2026-01-09): Build install command based on package manager
  function getInstallCmd(pm: "pnpm" | "npm" | "bun", frozen: boolean): string[] {
    switch (pm) {
      case "pnpm":
        return frozen ? ["pnpm", "install", "--frozen-lockfile"] : ["pnpm", "install"];
      case "bun":
        return frozen ? ["bun", "install", "--frozen-lockfile"] : ["bun", "install"];
      case "npm":
      default:
        return frozen ? ["npm", "ci"] : ["npm", "install"];
    }
  }

  try {
    console.log(`[git] Installing dependencies with ${actualPm}...`);
    const installCmd = getInstallCmd(actualPm, true);
    const installResult = spawnSync(installCmd[0], installCmd.slice(1), {
      cwd: workDir,
      encoding: "utf-8",
      timeout: CHECKOUT_INSTALL_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: ciEnv,
    });

    // Note (Replee, 2026-01-08): Check for timeout (signal is set when killed)
    if (installResult.signal) {
      console.log(`[git] Install timed out after ${CHECKOUT_INSTALL_TIMEOUT_MS}ms (signal: ${installResult.signal}). Continuing without deps.`);
    } else if (installResult.status !== 0) {
      console.log(`[git] Retrying ${actualPm} install without frozen lockfile...`);
      const retryCmd = getInstallCmd(actualPm, false);
      const retryResult = spawnSync(retryCmd[0], retryCmd.slice(1), {
        cwd: workDir,
        encoding: "utf-8",
        timeout: CHECKOUT_INSTALL_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
        env: ciEnv,
      });
      if (retryResult.signal) {
        console.log(`[git] Retry install timed out (signal: ${retryResult.signal}). Continuing without deps.`);
      }
    }
  } catch (err) {
    console.log(`[git] Warning: Failed to install dependencies: ${err}`);
  }

  // Note (Replee, 2026-01-08): Use readAllCodingGuidelines to find nested AGENTS.md files
  const guidelines = readAllCodingGuidelines(workDir);
  const result: Awaited<ReturnType<typeof checkoutPR>> = {
    success: true,
    workspace: workDir,
    repo,
    branch: prBranch,
    prUrl,
    message: `Checked out PR #${prNumber} (branch: ${prBranch}) at ${workDir}. Dependencies installed with ${actualPm}.`,
  };

  if (guidelines) {
    const nestedCount = guidelines.allFiles.length;
    const nestedInfo = nestedCount > 0 ? ` (+ ${nestedCount} nested guideline files)` : "";
    result.codingGuidelines = {
      filename: guidelines.filename + nestedInfo,
      content: guidelines.content,
      warning: "⚠️ IMPORTANT: You MUST follow ALL patterns in this file. Do NOT ignore these rules.",
    };
  }

  return result;
}

// Note (Kevin, 2026-01-06): Import timeout utility from github.ts
const GITHUB_API_TIMEOUT_MS = 30000;

// Note (Kevin, 2026-01-07): Cache TTL for repo list (5 minutes)
const REPO_LIST_CACHE_TTL_SECONDS = 300;

type RepoListResult = {
  success: boolean;
  org: string;
  count?: number;
  repos?: { fullName: string; name: string; description: string; url: string; pushedAt?: string }[];
  error?: string;
  hint?: string;
  cached?: boolean;
};

// Note (Kevin, 2026-01-07): Timeout for the entire listRepos operation
const LIST_REPOS_TIMEOUT_MS = 15000;

/**
 * List repositories in the organization using GitHub API
 * Results are cached for 5 minutes to reduce API calls
 * Note (Kevin, 2026-01-07): Wrapped with timeout to prevent hanging
 */
export async function listRepos({ search, limit = 20 }: { search?: string; limit?: number } = {}): Promise<RepoListResult> {
  const org = GITHUB_ORG;

  // Note (Kevin, 2026-01-07): Wrap entire operation with timeout to prevent hanging
  const timeoutPromise = new Promise<RepoListResult>((resolve) => {
    setTimeout(() => {
      resolve({ success: false, org, error: `listRepos timed out after ${LIST_REPOS_TIMEOUT_MS}ms` });
    }, LIST_REPOS_TIMEOUT_MS);
  });

  const fetchRepos = async (): Promise<RepoListResult> => {
    const cacheKey = `github:repos:${org}:${search ?? "all"}:${limit}`;

    // Note (Kevin, 2026-01-07): Check cache first to reduce GitHub API calls
    const cached = await cacheGet<RepoListResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    try {
      const octokit = github.getOctokit();
      let repos: { fullName: string; name: string; description: string; url: string; pushedAt?: string }[];

      if (search) {
        // Search repos in the organization
        const { data } = await github.withTimeout(
          octokit.rest.search.repos({
            q: `${search} org:${org}`,
            per_page: limit,
            sort: "updated",
            order: "desc",
          }),
          GITHUB_API_TIMEOUT_MS,
          "GitHub search repos"
        );
        repos = data.items.map((repo) => ({
          fullName: repo.full_name,
          name: repo.name,
          description: repo.description ?? "(no description)",
          url: repo.html_url,
          pushedAt: repo.pushed_at ?? undefined,
        }));
      } else {
        // List org repos
        const { data } = await github.withTimeout(
          octokit.rest.repos.listForOrg({
            org,
            per_page: limit,
            sort: "pushed",
            direction: "desc",
          }),
          GITHUB_API_TIMEOUT_MS,
          "GitHub list org repos"
        );
        repos = data.map((repo) => ({
          fullName: repo.full_name,
          name: repo.name,
          description: repo.description ?? "(no description)",
          url: repo.html_url,
          pushedAt: repo.pushed_at ?? undefined,
        }));
      }

      const result: RepoListResult = {
        success: true,
        org,
        count: repos.length,
        repos,
        hint: "Use the 'fullName' value (e.g., 'replohq/andytown') as the 'repo' parameter for setup_workspace",
      };

      // Note (Kevin, 2026-01-07): Cache successful results
      await cacheSet(cacheKey, result, REPO_LIST_CACHE_TTL_SECONDS);

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, org, error: `Failed to list repos: ${errorMsg}` };
    }
  };

  return Promise.race([fetchRepos(), timeoutPromise]);
}
