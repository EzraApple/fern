import { tool } from "@opencode-ai/plugin";
import { getPRStatus } from "../../core/github-service.js";

export const github_pr_status = tool({
  description:
    "Check the status of a pull request — state, CI checks, reviews, and mergeability. Use to monitor PRs you've created, verify CI is passing, or check if a PR has been reviewed. Useful in scheduled jobs that follow up on open PRs.",
  args: {
    prNumber: tool.schema.number().describe("PR number (e.g., 42)"),
    repo: tool.schema
      .string()
      .describe("Repository in owner/repo format (e.g., 'EzraApple/fern') or full URL"),
  },
  async execute(args) {
    try {
      const status = await getPRStatus(args.prNumber, args.repo);

      const checksStatus =
        status.checks.length > 0
          ? status.checks.map((c) => `- ${c.name}: ${c.conclusion || c.status}`).join("\n")
          : "- No checks";

      const reviewsStatus =
        status.reviews.length > 0
          ? status.reviews.map((r) => `- ${r.user}: ${r.state}`).join("\n")
          : "- No reviews";

      return `PR #${args.prNumber} Status:
State: ${status.state}
Mergeable: ${status.mergeable}

Checks:
${checksStatus}

Reviews:
${reviewsStatus}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error getting PR status: ${message}`;
    }
  },
});
