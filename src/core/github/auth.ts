import { loadConfig } from "@/config/config.js";
import { App } from "@octokit/app";

// Cached instances
let appInstance: App | null = null;
// biome-ignore lint/suspicious/noExplicitAny: Octokit type from @octokit/app is compatible but has different signature
let octokitInstance: any = null;

/**
 * Parse repository URL or owner/repo string into owner and repo name
 */
export function parseRepo(repoInput: string): { owner: string; repo: string } {
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
 * Reset cached Octokit instance (for testing or config changes)
 */
export function resetOctokit(): void {
  octokitInstance = null;
  appInstance = null;
}
