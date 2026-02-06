import { tool } from "@opencode-ai/plugin";
import { createPullRequest } from "../../core/github-service.js";
import { cleanupWorkspace, getWorkspaceById } from "../../core/workspace.js";

export const github_pr = tool({
  description:
    "Create a pull request. The PR will be created by the Fern GitHub App (not your personal account). Use this instead of 'gh pr create'. If you have a workspace, it will be cleaned up after PR creation.",
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
