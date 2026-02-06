import { tool } from "@opencode-ai/plugin";
import { pushBranch } from "../../core/workspace-git.js";
import { getWorkspaceById } from "../../core/workspace.js";

export const github_push = tool({
  description:
    "Push the current branch to the remote repository. This makes the changes available for PR creation. Requires GitHub authentication to be configured.",
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
