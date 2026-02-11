import { tool } from "@opencode-ai/plugin";
import { pushBranch } from "../../core/workspace-git.js";
import { getWorkspaceById } from "../../core/workspace.js";

export const github_push = tool({
  description:
    "Push the current branch to the remote repository. Call after github_commit and before github_pr. This makes the branch available on GitHub for PR creation. Uses the Fern GitHub App for authentication — no personal credentials needed.",
  args: {
    workspaceId: tool.schema.string().describe("Workspace ID from github_clone"),
  },
  async execute(args) {
    try {
      const workspace = getWorkspaceById(args.workspaceId);
      if (!workspace) {
        return `Error: Workspace ${args.workspaceId} not found`;
      }

      await pushBranch(workspace);
      return `Pushed branch ${workspace.branch} to origin`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error pushing branch: ${message}`;
    }
  },
});
