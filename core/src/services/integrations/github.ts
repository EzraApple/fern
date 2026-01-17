import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { CreatePRInput, PRComment, PullRequest } from "@/types/index.js";
import { logger } from "@/config/index.js";
import { cacheGet, cacheSet } from "@/services/cache.js";
import { withRetry } from "./retry.js";

const execAsync = promisify(exec);

// Note (Kevin, 2026-01-06): Hard timeout for all GitHub API operations
// Octokit's built-in timeout doesn't always work for DNS/connection issues
const GITHUB_API_TIMEOUT_MS = 30000;

// Note (Kevin, 2026-01-07): Cache TTLs for GitHub API responses
const AUTH_USER_CACHE_TTL_SECONDS = 3600; // 1 hour - bot identity never changes
const EMAIL_USER_CACHE_TTL_SECONDS = 604800; // 7 days - email→user mapping rarely changes
const EMAIL_NOT_FOUND_SENTINEL = "__NOT_FOUND__";

// Note (Kevin, 2026-01-07): Retry config for GitHub API calls
const GITHUB_RETRY_CONFIG = {
  integrationName: "GitHub",
  maxRetries: 3,
  maxRateLimitWaitMs: 60000, // Wait up to 60s for rate limits
};

/**
 * Wrap a promise with a hard timeout to prevent hanging
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

// Singleton Octokit instance
let octokitInstance: Octokit | null = null;

/**
 * Get or create the Octokit client
 * Uses GitHub App authentication (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID)
 * Falls back to GITHUB_TOKEN if App credentials are not set
 */
export function getOctokit(): Octokit {
  if (!octokitInstance) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

    if (appId && privateKey && installationId) {
      // Note (Kevin, 2026-01-06): GitHub App authentication for higher rate limits and app-level permissions
      logger.info("[GitHub] Using GitHub App authentication");
      octokitInstance = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId,
          privateKey: privateKey.replace(/\\n/g, "\n"),
          installationId: parseInt(installationId, 10),
        },
        request: {
          timeout: 30000,
        },
      });
    } else {
      // Fallback to personal access token
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error(
          "GitHub authentication not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID for App auth, or GITHUB_TOKEN for PAT auth."
        );
      }
      logger.info("[GitHub] Using personal access token authentication");
      octokitInstance = new Octokit({
        auth: token,
        request: {
          timeout: 30000,
        },
      });
    }
  }
  return octokitInstance;
}

/**
 * Parse owner and repo from a repo string like "owner/repo"
 */
function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
  }
  return { owner, repo: repoName };
}

/**
 * Get owner/repo from a local git repository path
 */
async function getRepoFromPath(repoPath: string): Promise<{ owner: string; repo: string }> {
  try {
    const { stdout } = await execAsync("git remote get-url origin", { cwd: repoPath });
    const url = stdout.trim();

    // Handle both HTTPS and SSH URLs
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      throw new Error(`Could not parse GitHub URL: ${url}`);
    }
    return { owner: match[1], repo: match[2] };
  } catch (error) {
    throw new Error(`Failed to get repo info from ${repoPath}: ${error}`);
  }
}

/**
 * Check if authenticated with GitHub
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const octokit = getOctokit();
    // Note (Kevin, 2026-01-06): For GitHub App auth, check app installation instead of user
    if (process.env.GITHUB_APP_ID) {
      // GitHub App - verify by making a simple API call
      await octokit.rest.rateLimit.get();
      return true;
    }
    await octokit.rest.users.getAuthenticated();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the authenticated user's login (or bot name for GitHub App)
 * Results are cached for 1 hour since bot identity never changes
 */
export async function getAuthenticatedUser(): Promise<string> {
  const cacheKey = "github:authenticated_user";

  // Note (Kevin, 2026-01-07): Check cache first - bot identity never changes
  const cached = await cacheGet<string>(cacheKey);
  if (cached) return cached;

  const octokit = getOctokit();
  let result: string;

  // Note (Kevin, 2026-01-06): GitHub Apps authenticate as a bot, not a user
  if (process.env.GITHUB_APP_ID) {
    // Return the bot username format: app-name[bot]
    // For GitHub Apps, we use the app slug from the installation
    try {
      const response = await octokit.rest.apps.getAuthenticated();
      const slug = response.data?.slug;
      result = `${slug ?? "replee"}[bot]`;
    } catch {
      // Fallback to a generic name
      result = "replee[bot]";
    }
  } else {
    const { data } = await octokit.rest.users.getAuthenticated();
    result = data.login;
  }

  await cacheSet(cacheKey, result, AUTH_USER_CACHE_TTL_SECONDS);
  return result;
}

/**
 * Create a pull request
 */
export async function createPR(
  input: CreatePRInput,
  repoPath: string
): Promise<PullRequest> {
  const { title, body, branch, baseBranch, draft } = input;
  const base = baseBranch ?? "main";
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branch,
    base,
    draft: draft ?? false,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? body,
    url: data.url,
    htmlUrl: data.html_url,
    state: data.state as "open" | "closed" | "merged",
    head: {
      ref: data.head.ref,
      sha: data.head.sha,
    },
    base: {
      ref: data.base.ref,
    },
  };
}

/**
 * Get a pull request by number
 */
export async function getPR(
  prNumber: number,
  repoPath: string
): Promise<PullRequest> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    url: data.url,
    htmlUrl: data.html_url,
    state: data.merged ? "merged" : (data.state as "open" | "closed"),
    head: {
      ref: data.head.ref,
      sha: data.head.sha,
    },
    base: {
      ref: data.base.ref,
    },
  };
}

/**
 * Get a pull request by number (using repo string owner/repo)
 */
async function getPRByRepo({
  repo,
  prNumber,
}: {
  repo: string;
  prNumber: number;
}): Promise<PullRequest> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    url: data.url,
    htmlUrl: data.html_url,
    state: data.merged ? "merged" : (data.state as "open" | "closed"),
    head: {
      ref: data.head.ref,
      sha: data.head.sha,
    },
    base: {
      ref: data.base.ref,
    },
  };
}

/**
 * Add a comment to a pull request (issue comment, not review comment)
 */
export async function addComment(
  prNumber: number,
  body: string,
  repoPath: string
): Promise<void> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

/**
 * Reply to a specific comment (creates a new issue comment)
 */
async function replyToComment(
  prNumber: number,
  _commentId: number,
  body: string,
  repoPath: string
): Promise<void> {
  // GitHub doesn't have direct reply to issue comments, so we just add a new comment
  await addComment(prNumber, body, repoPath);
}

/**
 * Get comments on a pull request (issue comments)
 */
export async function getComments(
  prNumber: number,
  repoPath: string
): Promise<PRComment[]> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  return data.map((comment) => ({
    id: comment.id,
    body: comment.body ?? "",
    user: { login: comment.user?.login ?? "unknown" },
    prNumber,
    createdAt: comment.created_at,
  }));
}

/**
 * Get comments on a pull request by repo name (without local clone)
 */
export async function getCommentsByRepo({
  repo,
  prNumber,
}: {
  repo: string;
  prNumber: number;
}): Promise<PRComment[]> {
  try {
    const { owner, repo: repoName } = parseRepo(repo);
    const octokit = getOctokit();

    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo: repoName,
      issue_number: prNumber,
    });

    return data.map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      user: { login: comment.user?.login ?? "unknown" },
      prNumber,
      createdAt: comment.created_at,
    }));
  } catch (error) {
    logger.warn(`[GitHub] Failed to fetch PR comments for ${repo}#${prNumber}:`, error);
    return [];
  }
}

/**
 * Get review comments (inline comments on code) by repo name
 */
export async function getReviewCommentsByRepo({
  repo,
  prNumber,
}: {
  repo: string;
  prNumber: number;
}): Promise<PRComment[]> {
  try {
    const { owner, repo: repoName } = parseRepo(repo);
    const octokit = getOctokit();

    const { data } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return data.map((comment) => ({
      id: comment.id,
      body: comment.body,
      user: { login: comment.user?.login ?? "unknown" },
      prNumber,
      createdAt: comment.created_at,
      path: comment.path,
      line: comment.line ?? undefined,
      startLine: comment.start_line ?? undefined,
      diffHunk: comment.diff_hunk,
    }));
  } catch (error) {
    logger.warn(`[GitHub] Failed to fetch review comments for ${repo}#${prNumber}:`, error);
    return [];
  }
}

/**
 * Add a reaction to an issue comment
 */
export async function addReactionToComment({
  repo,
  commentId,
  reaction,
}: {
  repo: string;
  commentId: number;
  reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
}): Promise<void> {
  try {
    const { owner, repo: repoName } = parseRepo(repo);
    const octokit = getOctokit();

    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo: repoName,
      comment_id: commentId,
      content: reaction,
    });
    logger.debug(`[GitHub] Added ${reaction} reaction to comment ${commentId}`);
  } catch (error) {
    logger.warn(`[GitHub] Failed to add reaction to comment ${commentId}:`, error);
  }
}

/**
 * Add a reaction to a review comment (inline code comment)
 */
export async function addReactionToReviewComment({
  repo,
  commentId,
  reaction,
}: {
  repo: string;
  commentId: number;
  reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
}): Promise<void> {
  try {
    const { owner, repo: repoName } = parseRepo(repo);
    const octokit = getOctokit();

    await octokit.rest.reactions.createForPullRequestReviewComment({
      owner,
      repo: repoName,
      comment_id: commentId,
      content: reaction,
    });
    logger.debug(`[GitHub] Added ${reaction} reaction to review comment ${commentId}`);
  } catch (error) {
    logger.warn(`[GitHub] Failed to add reaction to review comment ${commentId}:`, error);
  }
}

/**
 * Get review comments (inline comments on code)
 */
export async function getReviewComments(
  prNumber: number,
  repoPath: string
): Promise<PRComment[]> {
  try {
    const { owner, repo } = await getRepoFromPath(repoPath);
    const octokit = getOctokit();

    const { data } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
    });

    return data.map((comment) => ({
      id: comment.id,
      body: comment.body,
      user: { login: comment.user?.login ?? "unknown" },
      prNumber,
      createdAt: comment.created_at,
      path: comment.path,
      line: comment.line ?? undefined,
      startLine: comment.start_line ?? undefined,
      diffHunk: comment.diff_hunk,
    }));
  } catch {
    return [];
  }
}

/**
 * List open PRs created by the authenticated user
 */
export async function listBotPRs(repoPath: string): Promise<PullRequest[]> {
  try {
    const { owner, repo } = await getRepoFromPath(repoPath);
    const octokit = getOctokit();
    const currentUser = await getAuthenticatedUser();

    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
    });

    // Filter to only PRs by the authenticated user
    const myPRs = data.filter((pr) => pr.user?.login === currentUser);

    return myPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      url: pr.url,
      htmlUrl: pr.html_url,
      state: pr.state as "open" | "closed" | "merged",
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Check if a PR exists for a branch
 */
async function prExistsForBranch(
  branchName: string,
  repoPath: string
): Promise<PullRequest | null> {
  try {
    const { owner, repo } = await getRepoFromPath(repoPath);
    const octokit = getOctokit();

    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
      state: "open",
    });

    if (data.length === 0) return null;

    const pr = data[0];
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      url: pr.url,
      htmlUrl: pr.html_url,
      state: pr.state as "open" | "closed" | "merged",
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Request reviewers for a PR (using local repo path)
 */
async function requestReviewers(
  prNumber: number,
  reviewers: string[],
  repoPath: string
): Promise<void> {
  if (reviewers.length === 0) return;

  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  await octokit.rest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: prNumber,
    reviewers,
  });
}

/**
 * Request reviewers for a PR (using repo string owner/repo)
 */
async function requestReviewersByRepo({
  repo,
  prNumber,
  reviewers,
}: {
  repo: string;
  prNumber: number;
  reviewers: string[];
}): Promise<void> {
  if (reviewers.length === 0) return;

  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  await octokit.rest.pulls.requestReviewers({
    owner,
    repo: repoName,
    pull_number: prNumber,
    reviewers,
  });
}

/**
 * Search for a GitHub user by email
 * Results are cached for 7 days since email→user mapping rarely changes
 */
export async function searchUserByEmail(email: string): Promise<string | null> {
  const cacheKey = `github:user_by_email:${email.toLowerCase()}`;

  // Note (Kevin, 2026-01-07): Check cache first - includes NOT_FOUND sentinel
  const cached = await cacheGet<string>(cacheKey);
  if (cached !== null) {
    return cached === EMAIL_NOT_FOUND_SENTINEL ? null : cached;
  }

  try {
    const octokit = getOctokit();
    const { data } = await octokit.rest.search.users({
      q: `${email} in:email`,
    });

    if (data.items.length > 0) {
      const login = data.items[0].login;
      await cacheSet(cacheKey, login, EMAIL_USER_CACHE_TTL_SECONDS);
      return login;
    }

    // Note (Kevin, 2026-01-07): Cache NOT_FOUND to avoid repeated lookups for unknown emails
    await cacheSet(cacheKey, EMAIL_NOT_FOUND_SENTINEL, EMAIL_USER_CACHE_TTL_SECONDS);
    return null;
  } catch {
    return null;
  }
}

/**
 * Get recent contributors to specific files
 */
async function getRecentContributors(
  files: string[],
  repoPath: string,
  options: { limit?: number; excludeAuthors?: string[] } = {}
): Promise<string[]> {
  const { limit = 3, excludeAuthors = [] } = options;

  try {
    const selfUsername = (await getAuthenticatedUser()).toLowerCase();
    const contributorCounts = new Map<string, number>();

    // Note (Kevin, 2026-01-07): Batch all git log calls in parallel to avoid N sequential execAsync calls
    const gitLogResults = await Promise.all(
      files.map(async (file) => {
        try {
          const { stdout } = await execAsync(
            `git log -10 --format="%aN|%aE" -- "${file}"`,
            { cwd: repoPath }
          );
          return stdout.trim().split("\n").filter(Boolean);
        } catch {
          // File might not exist in history, skip
          return [];
        }
      })
    );

    for (const lines of gitLogResults) {
      for (const line of lines) {
        const [name, email] = line.split("|");
        if (!name || !email) continue;
        if (email.includes("[bot]") || email.includes("noreply")) continue;

        const key = email.toLowerCase();
        contributorCounts.set(key, (contributorCounts.get(key) || 0) + 1);
      }
    }

    const sorted = [...contributorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([email]) => email);

    // Note (Kevin, 2026-01-07): Batch email lookups in parallel to avoid N sequential API calls
    const excludeAuthorsLower = excludeAuthors.map((a) => a.toLowerCase());
    const usernameLookups = await Promise.all(
      sorted.map(async (email) => {
        const username = await searchUserByEmail(email);
        return { email, username };
      })
    );

    const usernames = usernameLookups
      .filter(({ username }) =>
        username &&
        username.toLowerCase() !== selfUsername &&
        !excludeAuthorsLower.includes(username.toLowerCase())
      )
      .map(({ username }) => username!)
      .slice(0, limit);

    return usernames;
  } catch (error) {
    logger.warn(`[GitHub] Failed to get recent contributors:`, error);
    return [];
  }
}

/**
 * Auto-add reviewers to a PR based on who recently touched the affected files
 */
async function autoAddReviewers(
  prNumber: number,
  affectedFiles: string[],
  repoPath: string,
  options: { maxReviewers?: number } = {}
): Promise<string[]> {
  const { maxReviewers = 2 } = options;

  try {
    const reviewers = await getRecentContributors(affectedFiles, repoPath, {
      limit: maxReviewers,
    });

    if (reviewers.length > 0) {
      await requestReviewers(prNumber, reviewers, repoPath);
      logger.info(`[GitHub] Added reviewers to PR #${prNumber}: ${reviewers.join(", ")}`);
    }

    return reviewers;
  } catch (error) {
    logger.warn(`[GitHub] Failed to auto-add reviewers:`, error);
    return [];
  }
}

/**
 * Get the repository info
 */
async function getRepoInfo(
  repoPath: string
): Promise<{ owner: string; name: string; url: string }> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  return {
    owner: data.owner.login,
    name: data.name,
    url: data.html_url,
  };
}

// ============================================================================
// Repository Creation
// ============================================================================

interface CreateRepoOptions {
  name: string;
  description?: string;
  org?: string;
  private?: boolean;
  addReadme?: boolean;
  gitignore?: string;
  license?: string;
}

interface CreatedRepo {
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
  sshUrl: string;
  private: boolean;
  owner: string;
}

/**
 * Create a new GitHub repository
 */
async function createRepo(options: CreateRepoOptions): Promise<CreatedRepo> {
  const {
    name,
    description,
    org,
    private: isPrivate = true,
    addReadme = false,
    gitignore,
    license,
  } = options;

  const octokit = getOctokit();
  logger.info(`[GitHub] Creating repository: ${org ? `${org}/${name}` : name}`);

  let data;
  if (org) {
    const response = await octokit.rest.repos.createInOrg({
      org,
      name,
      description,
      private: isPrivate,
      auto_init: addReadme,
      gitignore_template: gitignore,
      license_template: license,
    });
    data = response.data;
  } else {
    const response = await octokit.rest.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: addReadme,
      gitignore_template: gitignore,
      license_template: license,
    });
    data = response.data;
  }

  const result: CreatedRepo = {
    name: data.name,
    fullName: data.full_name,
    url: data.html_url,
    cloneUrl: data.clone_url,
    sshUrl: data.ssh_url,
    private: data.private,
    owner: data.owner.login,
  };

  logger.info(`[GitHub] Created repository: ${result.fullName}`);
  return result;
}

/**
 * Fork a repository
 */
async function forkRepo(
  repo: string,
  options: { org?: string; name?: string } = {}
): Promise<CreatedRepo> {
  const { org, name } = options;
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  logger.info(`[GitHub] Forking repository: ${repo}`);

  const { data } = await octokit.rest.repos.createFork({
    owner,
    repo: repoName,
    organization: org,
    name,
  });

  const result: CreatedRepo = {
    name: data.name,
    fullName: data.full_name,
    url: data.html_url,
    cloneUrl: data.clone_url,
    sshUrl: data.ssh_url,
    private: data.private,
    owner: data.owner.login,
  };

  logger.info(`[GitHub] Forked repository: ${result.fullName}`);
  return result;
}

interface ListReposResult {
  repos: CreatedRepo[];
  total: number;
  page: number;
  hasNextPage: boolean;
}

// Note (Kevin, 2026-01-07): Cache TTL for repo list (20 minutes - repos change infrequently)
const REPOS_CACHE_TTL_SECONDS = 1200;

/**
 * List/search repositories for the authenticated user or an organization
 * Note (Kevin, 2026-01-07): Uses search API for faster results, with retry, pagination, and caching
 */
async function listRepos(
  options: { org?: string; search?: string; limit?: number; page?: number; visibility?: "public" | "private" | "all" } = {}
): Promise<ListReposResult> {
  const { org, search, limit = 30, page = 1, visibility = "all" } = options;

  // Note (Kevin, 2026-01-07): Cache key includes all query parameters
  const cacheKey = `github:repos:${org ?? "me"}:${search ?? ""}:${limit}:${page}:${visibility}`;
  const cached = await cacheGet<ListReposResult>(cacheKey);
  if (cached) {
    return cached;
  }

  const octokit = getOctokit();

  // Note (Kevin, 2026-01-07): Use search API for faster, more targeted results
  // Build query: org filter + optional search term + visibility filter
  let query = org ? `org:${org}` : `user:@me`;
  if (search) {
    query = `${search} ${query}`;
  }
  if (visibility === "public") {
    query = `${query} is:public`;
  } else if (visibility === "private") {
    query = `${query} is:private`;
  }

  const { data } = await withRetry({
    fn: () => withTimeout(
      octokit.rest.search.repos({
        q: query,
        per_page: limit,
        page,
        sort: "updated",
        order: "desc",
      }),
      GITHUB_API_TIMEOUT_MS,
      "GitHub searchRepos"
    ),
    config: GITHUB_RETRY_CONFIG,
  });

  const repos = data.items.map((repo) => ({
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    cloneUrl: repo.clone_url ?? `${repo.html_url}.git`,
    sshUrl: repo.ssh_url ?? "",
    private: repo.private,
    owner: repo.owner?.login ?? "",
  }));

  const result = {
    repos,
    total: data.total_count,
    page,
    hasNextPage: page * limit < data.total_count,
  };

  // Note (Kevin, 2026-01-07): Cache successful results
  await cacheSet(cacheKey, result, REPOS_CACHE_TTL_SECONDS);

  return result;
}

// ============================================================================
// PR Body Formatting
// ============================================================================

interface PRBodyOptions {
  issueUrl?: string;
  issueTitle: string;
  linearUrl?: string;
  linearId?: string;
  rootCause: string;
  solution: string;
  affectedFiles: string[];
  unitTestsPassed?: boolean;
  e2eTestsPassed?: boolean;
  screenshots?: string[];
  videos?: string[];
}

/**
 * Format a PR body using the standard template
 */
function formatPRBody(options: PRBodyOptions): string {
  const {
    issueUrl,
    issueTitle,
    linearUrl,
    linearId,
    rootCause,
    solution,
    affectedFiles,
    unitTestsPassed,
    e2eTestsPassed,
    screenshots,
    videos,
  } = options;

  const lines: string[] = [];

  lines.push("## Description");
  lines.push("");

  const issueLinks: string[] = [];
  if (issueUrl) {
    issueLinks.push(`[${issueTitle}](${issueUrl})`);
  }
  if (linearUrl && linearId) {
    issueLinks.push(`[${linearId}](${linearUrl})`);
  }
  if (issueLinks.length > 0) {
    lines.push(`Fixes ${issueLinks.join(" / ")}`);
    lines.push("");
  }

  lines.push(`**Root cause:** ${rootCause}`);
  lines.push("");
  lines.push(`**Solution:** ${solution}`);
  lines.push("");

  lines.push("**Affected files:**");
  for (const file of affectedFiles) {
    lines.push(`- \`${file}\``);
  }
  lines.push("");

  lines.push("## Testing Done");
  lines.push("");

  if (unitTestsPassed !== undefined) {
    lines.push(unitTestsPassed ? "- [x] Unit tests pass" : "- [ ] Unit tests pass");
  } else {
    lines.push("- [ ] Unit tests pass");
  }

  if (e2eTestsPassed !== undefined) {
    lines.push(e2eTestsPassed ? "- [x] E2E tests pass" : "- [ ] E2E tests pass (if applicable)");
  } else {
    lines.push("- [ ] E2E tests pass (if applicable)");
  }
  lines.push("");

  if (screenshots && screenshots.length > 0) {
    lines.push("### Screenshots");
    lines.push("");
    for (let i = 0; i < screenshots.length; i++) {
      const label = i === 0 ? "Before fix" : i === 1 ? "After fix" : `Screenshot ${i + 1}`;
      lines.push(`![${label}](${screenshots[i]})`);
    }
    lines.push("");
  }

  if (videos && videos.length > 0) {
    lines.push("### Video Recording");
    lines.push("");
    for (const video of videos) {
      lines.push(`[View test recording](${video})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// PR Reviews
// ============================================================================

interface ReviewComment {
  path: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  body: string;
}

interface CreateReviewInput {
  prNumber: number;
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  body?: string;
  comments?: ReviewComment[];
  commitId?: string;
}

interface Review {
  id: number;
  body: string;
  state: string;
  htmlUrl: string;
}

/**
 * Create a PR review with optional inline comments
 */
async function createReview({
  prNumber,
  event,
  body,
  comments,
  commitId,
  repoPath,
}: CreateReviewInput & { repoPath: string }): Promise<Review> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
    commit_id: commitId,
    comments: comments?.map((c) => ({
      path: c.path,
      body: c.body,
      line: c.line,
      start_line: c.startLine,
      side: c.side,
    })),
  });

  return {
    id: data.id,
    body: data.body ?? "",
    state: data.state,
    htmlUrl: data.html_url,
  };
}

/**
 * Add a single inline comment to a PR
 */
async function addInlineComment({
  prNumber,
  path,
  line,
  body,
  side = "RIGHT",
  repoPath,
}: {
  prNumber: number;
  path: string;
  line: number;
  body: string;
  side?: "LEFT" | "RIGHT";
  repoPath: string;
}): Promise<PRComment> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  // Get the latest commit SHA for the PR
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data } = await octokit.rest.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    body,
    path,
    line,
    side,
    commit_id: pr.head.sha,
  });

  return {
    id: data.id,
    body: data.body,
    user: { login: data.user?.login ?? "unknown" },
    prNumber,
    createdAt: data.created_at,
    path: data.path,
    line: data.line ?? undefined,
    startLine: data.start_line ?? undefined,
    diffHunk: data.diff_hunk,
  };
}

/**
 * Add a single inline comment to a PR (by repo string)
 * Note (Kevin, 2026-01-08): Exported version for use by agent tools
 */
export async function addInlineCommentByRepo({
  repo,
  prNumber,
  path,
  line,
  body,
  startLine,
  side = "RIGHT",
}: {
  repo: string;
  prNumber: number;
  path: string;
  line: number;
  body: string;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
}): Promise<PRComment> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  // Get the latest commit SHA for the PR
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  const { data } = await octokit.rest.pulls.createReviewComment({
    owner,
    repo: repoName,
    pull_number: prNumber,
    body,
    path,
    line,
    start_line: startLine,
    side,
    commit_id: pr.head.sha,
  });

  return {
    id: data.id,
    body: data.body,
    user: { login: data.user?.login ?? "unknown" },
    prNumber,
    createdAt: data.created_at,
    path: data.path,
    line: data.line ?? undefined,
    startLine: data.start_line ?? undefined,
    diffHunk: data.diff_hunk,
  };
}

/**
 * Get the diff for a PR
 */
async function getPRDiff(
  prNumber: number,
  repoPath: string
): Promise<string> {
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: "diff" },
  });

  // When requesting diff format, data is a string
  return data as unknown as string;
}

/**
 * Upload a file to a GitHub release for hosting
 */
async function uploadToRelease(
  filePath: string,
  repoPath: string,
  releaseName: string = "replee-artifacts"
): Promise<string | null> {
  if (!existsSync(filePath)) {
    logger.warn(`File not found: ${filePath}`);
    return null;
  }

  const fileName = basename(filePath);
  const { owner, repo } = await getRepoFromPath(repoPath);
  const octokit = getOctokit();

  try {
    // Check if release exists
    let release;
    try {
      const { data } = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag: releaseName,
      });
      release = data;
    } catch {
      // Create draft release for artifacts
      const { data } = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: releaseName,
        name: "Replee Artifacts",
        body: "Artifacts from automated fixes",
        draft: true,
      });
      release = data;
    }

    // Read file and upload
    const content = readFileSync(filePath);

    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: release.id,
      name: fileName,
      // @ts-expect-error - Octokit types are overly strict here
      data: content,
    });

    const url = `https://github.com/${owner}/${repo}/releases/download/${releaseName}/${fileName}`;
    logger.info(`Uploaded ${fileName} to release`);
    return url;
  } catch (error) {
    logger.error(`Failed to upload to release:`, error);
    return null;
  }
}

// ============================================================================
// Additional API methods for other files
// ============================================================================

/**
 * Get PR author login by repo string
 */
export async function getPRAuthor({
  repo,
  prNumber,
}: {
  repo: string;
  prNumber: number;
}): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  return data.user?.login ?? "unknown";
}

/**
 * Get workflow run jobs that failed
 */
async function getFailedWorkflowJobs({
  repo,
  runId,
}: {
  repo: string;
  runId: number;
}): Promise<{ name: string; id: number }[]> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  const { data } = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo: repoName,
    run_id: runId,
  });

  return data.jobs
    .filter((job) => job.conclusion === "failure")
    .map((job) => ({ name: job.name, id: job.id }));
}

/**
 * Get job logs (limited to last 500 lines)
 */
async function getJobLogs({
  repo,
  jobId,
}: {
  repo: string;
  jobId: number;
}): Promise<string> {
  try {
    const { owner, repo: repoName } = parseRepo(repo);
    const octokit = getOctokit();

    const { data } = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo: repoName,
      job_id: jobId,
    });

    // data is a string of logs
    const logs = data as unknown as string;
    const lines = logs.split("\n");
    return lines.slice(-500).join("\n");
  } catch {
    return "";
  }
}

/**
 * Create an issue comment by repo string
 */
export async function createIssueComment({
  repo,
  issueNumber,
  body,
}: {
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<number> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    body,
  });

  return data.id;
}

/**
 * Update an issue comment
 */
export async function updateIssueComment({
  repo,
  commentId,
  body,
}: {
  repo: string;
  commentId: number;
  body: string;
}): Promise<void> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  await octokit.rest.issues.updateComment({
    owner,
    repo: repoName,
    comment_id: commentId,
    body,
  });
}

/**
 * Reply to a review comment (creates a reply in the same thread)
 */
export async function replyToReviewComment({
  repo,
  prNumber,
  commentId,
  body,
}: {
  repo: string;
  prNumber: number;
  commentId: number;
  body: string;
}): Promise<number> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  const { data } = await octokit.rest.pulls.createReplyForReviewComment({
    owner,
    repo: repoName,
    pull_number: prNumber,
    comment_id: commentId,
    body,
  });

  return data.id;
}

/**
 * Add a reaction to an issue or PR
 */
async function addReactionToIssue({
  repo,
  issueNumber,
  reaction,
}: {
  repo: string;
  issueNumber: number;
  reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
}): Promise<void> {
  const { owner, repo: repoName } = parseRepo(repo);
  const octokit = getOctokit();

  await octokit.rest.reactions.createForIssue({
    owner,
    repo: repoName,
    issue_number: issueNumber,
    content: reaction,
  });
}

/**
 * List PRs matching a search pattern using GitHub Search API
 * Supports GitHub search syntax like "head:branch-name" or "in:title"
 */
export async function listPRsBySearch({
  repo,
  search,
  state = "open",
  limit = 10,
}: {
  repo: string;
  search: string;
  state?: "open" | "merged" | "closed" | "all";
  limit?: number;
}): Promise<{ number: number; title: string; url: string; mergedAt?: string }[]> {
  try {
    const octokit = getOctokit();

    // Build search query
    // is:pr repo:owner/repo is:open/merged/closed search-term
    let stateFilter = "";
    if (state === "open") {
      stateFilter = "is:open";
    } else if (state === "merged") {
      stateFilter = "is:merged";
    } else if (state === "closed") {
      stateFilter = "is:closed";
    }
    // state === "all" means no state filter

    const query = `is:pr repo:${repo} ${stateFilter} ${search}`.trim();

    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: limit,
      sort: "updated",
      order: "desc",
    });

    return data.items.map((item) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
      // Note (Kevin, 2026-01-05): Search API doesn't include merged_at directly,
      // but merged PRs can be identified by state filter
      mergedAt: item.pull_request?.merged_at ?? undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Search commits by author email
 */
export async function searchCommitsByAuthorEmail(email: string): Promise<string | null> {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.rest.search.commits({
      q: `author-email:${email}`,
      per_page: 1,
    });

    if (data.items.length > 0 && data.items[0].author) {
      return data.items[0].author.login;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List all repositories in an organization
 */
export async function listOrgRepos(org: string): Promise<string[]> {
  // Note (Kevin, 2026-01-06): Wrap entire pagination in timeout to prevent hanging
  const fetchRepos = async (): Promise<string[]> => {
    const octokit = getOctokit();
    const repos: string[] = [];

    // Paginate through all repos
    for await (const response of octokit.paginate.iterator(
      octokit.rest.repos.listForOrg,
      { org, per_page: 100 }
    )) {
      for (const repo of response.data) {
        repos.push(`${org}/${repo.name}`);
      }
    }

    return repos;
  };

  try {
    return await withTimeout(fetchRepos(), GITHUB_API_TIMEOUT_MS * 2, "GitHub listOrgRepos");
  } catch {
    return [];
  }
}
