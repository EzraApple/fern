import { App } from "@octokit/app";
import { loadConfig } from "../config/config.js";

// Types
export interface PRInfo {
  url: string;
  number: number;
  state: string;
}

export interface PRStatus {
  state: string;
  mergeable: boolean | null;
  checks: CheckStatus[];
  reviews: Review[];
}

export interface CheckStatus {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface Review {
  user: string;
  state: string;
  submittedAt: string;
}

export interface CreatePRParams {
  repo: string; // "owner/repo" format or full URL
  branch: string;
  title: string;
  body: string;
  base?: string; // Default: main
}

// Cached instances
let appInstance: App | null = null;
// biome-ignore lint/suspicious/noExplicitAny: Octokit type from @octokit/app is compatible but has different signature
let octokitInstance: any = null;

/**
 * Parse repository URL or owner/repo string into owner and repo name
 */
function parseRepo(repoInput: string): { owner: string; repo: string } {
  // Handle full GitHub URLs (strip any embedded credentials)
  if (repoInput.startsWith("http://") || repoInput.startsWith("https://")) {
    const match = repoInput.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid GitHub URL: ${repoInput}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  // Handle owner/repo format
  const parts = repoInput.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: ${repoInput}. Expected "owner/repo" or full GitHub URL`);
  }

  return { owner: parts[0], repo: parts[1] };
}

/**
 * Get or create the GitHub App instance.
 * Throws if credentials are not configured.
 */
function getAppAndInstallationId(): { app: App; installationId: number } {
  const config = loadConfig();

  if (!config.github?.appId || !config.github?.privateKey || !config.github?.installationId) {
    throw new Error(
      "GitHub App credentials not configured. Please set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID in .env"
    );
  }

  if (!appInstance) {
    appInstance = new App({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    });
  }

  return {
    app: appInstance,
    installationId: Number.parseInt(config.github.installationId, 10),
  };
}

/**
 * Get authenticated Octokit instance (for API calls like PR creation).
 */
// biome-ignore lint/suspicious/noExplicitAny: Octokit type from @octokit/app is compatible but has different signature
export async function getOctokit(): Promise<any> {
  if (octokitInstance) {
    return octokitInstance;
  }

  const { app, installationId } = getAppAndInstallationId();

  console.info("[GitHub] Authenticating with GitHub App...");
  // biome-ignore lint/suspicious/noExplicitAny: Octokit instance from @octokit/app
  octokitInstance = (await app.getInstallationOctokit(installationId)) as any;
  console.info("[GitHub] Authenticated with GitHub App");

  return octokitInstance;
}

/**
 * Get a fresh installation access token for git operations (clone, push).
 * Tokens are short-lived (~1 hour) so this should be called close to when it's needed.
 */
export async function getInstallationToken(): Promise<string> {
  const { app, installationId } = getAppAndInstallationId();

  const response = await app.octokit.request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: installationId }
  );

  return response.data.token;
}

/**
 * Build an HTTPS clone/push URL authenticated with the GitHub App installation token.
 * Accepts any repo format: "owner/repo", full GitHub URL, etc.
 */
export async function getAuthenticatedCloneUrl(repoUrl: string): Promise<string> {
  const { owner, repo } = parseRepo(repoUrl);
  const token = await getInstallationToken();
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * Create a pull request
 */
export async function createPullRequest(params: CreatePRParams): Promise<PRInfo> {
  const octokit = await getOctokit();
  const { owner, repo } = parseRepo(params.repo);
  const base = params.base || "main";

  console.info(`[GitHub] Creating PR: ${owner}/${repo} ${params.branch} -> ${base}`);

  try {
    const response = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
      owner,
      repo,
      title: params.title,
      body: params.body,
      head: params.branch,
      base,
    });

    console.info(`[GitHub] PR created: #${response.data.number} - ${response.data.html_url}`);

    return {
      url: response.data.html_url,
      number: response.data.number,
      state: response.data.state,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[GitHub] Failed to create PR: ${error.message}`);
      throw new Error(`Failed to create PR: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get PR status (state, checks, reviews)
 */
export async function getPRStatus(prNumber: number, repoInput: string): Promise<PRStatus> {
  const octokit = await getOctokit();
  const { owner, repo } = parseRepo(repoInput);

  console.info(`[GitHub] Fetching PR status: ${owner}/${repo}#${prNumber}`);

  try {
    // Get PR details
    const prResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner,
      repo,
      pull_number: prNumber,
    });

    // Get check runs
    const checksResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
      {
        owner,
        repo,
        ref: prResponse.data.head.sha,
      }
    );

    // Get reviews
    const reviewsResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        owner,
        repo,
        pull_number: prNumber,
      }
    );

    const checks: CheckStatus[] = checksResponse.data.check_runs.map(
      // biome-ignore lint/suspicious/noExplicitAny: GitHub API response type
      (check: any) => ({
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
      })
    );

    const reviews: Review[] = reviewsResponse.data.map(
      // biome-ignore lint/suspicious/noExplicitAny: GitHub API response type
      (review: any) => ({
        user: review.user?.login || "unknown",
        state: review.state,
        submittedAt: review.submitted_at || "",
      })
    );

    return {
      state: prResponse.data.state,
      mergeable: prResponse.data.mergeable,
      checks,
      reviews,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[GitHub] Failed to get PR status: ${error.message}`);
      throw new Error(`Failed to get PR status: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Reset cached Octokit instance (for testing or config changes)
 */
export function resetOctokit(): void {
  octokitInstance = null;
  appInstance = null;
}
