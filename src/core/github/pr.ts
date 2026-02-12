import { getOctokit, parseRepo } from "@/core/github/auth.js";
import type { CheckStatus, CreatePRParams, PRInfo, PRStatus, Review } from "@/core/github/types.js";

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
 * List pull requests for a repository
 */
export async function listPRs(
  repoInput: string,
  state: "open" | "closed" | "all" = "all"
): Promise<
  Array<{
    number: number;
    title: string;
    state: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    user: string;
    branch: string;
  }>
> {
  const octokit = await getOctokit();
  const { owner, repo } = parseRepo(repoInput);

  const response = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo,
    state,
    per_page: 30,
    sort: "updated",
    direction: "desc",
  });

  // biome-ignore lint/suspicious/noExplicitAny: GitHub API response type
  return response.data.map((pr: any) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    url: pr.html_url,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    user: pr.user?.login || "unknown",
    branch: pr.head?.ref || "",
  }));
}
