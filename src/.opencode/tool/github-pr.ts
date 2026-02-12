import { createPullRequest } from "@/core/github/pr.js";
import { cleanupWorkspace, getWorkspaceById } from "@/core/workspace.js";
import { tool } from "@opencode-ai/plugin";

export const github_pr = tool({
  description:
    "Create a pull request on GitHub. This is the final step of the self-improvement workflow. The PR is created by the Fern GitHub App, not a personal account. Always use this instead of 'gh pr create' via bash. Write a descriptive body: explain what changed, why, and how to verify. Include the workspace ID to auto-clean the workspace after PR creation. Prefix PR titles with '[Fern]' for self-improvement changes.",
  args: {
    repo: tool.schema
      .string()
      .describe("Repository in owner/repo format (e.g., 'EzraApple/fern') or full URL"),
    branch: tool.schema
      .string()
      .describe("Branch name to create PR from (e.g., 'fern/test-phase-2')"),
    title: tool.schema
      .string()
      .describe(
        "PR title (should be concise and descriptive, e.g., '[Fern] Add retry logic to API calls')"
      ),
    body: tool.schema
      .string()
      .describe("PR description (explain what changed, why, and how to test it)"),
    workspaceId: tool.schema
      .string()
      .optional()
      .describe("Optional: Workspace ID from github_clone (will be cleaned up after PR creation)"),
  },
  async execute(args) {
    try {
      // Create PR
      const pr = await createPullRequest({
        repo: args.repo,
        branch: args.branch,
        title: args.title,
        body: args.body,
      });

      // Clean up workspace if provided
      if (args.workspaceId) {
        const workspace = getWorkspaceById(args.workspaceId);
        if (workspace) {
          await cleanupWorkspace(workspace.path);
          return `Created PR #${pr.number}: ${args.title}\nURL: ${pr.url}\nWorkspace cleaned up.`;
        }
      }

      return `Created PR #${pr.number}: ${args.title}\nURL: ${pr.url}\n\nNote: This PR was created by the Fern GitHub App, not your personal account.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error creating PR: ${message}`;
    }
  },
});
