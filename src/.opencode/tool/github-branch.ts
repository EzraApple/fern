import { tool } from "@opencode-ai/plugin";
import { createBranch } from "../../core/workspace-git.js";
import { getWorkspaceById } from "../../core/workspace.js";

export const github_branch = tool({
  description:
    "Create a new feature branch in a cloned workspace. Call this right after github_clone, before making any changes. Use the naming convention 'fern/descriptive-name' for self-improvement changes (e.g., 'fern/add-retry-logic', 'fern/fix-memory-search'). Never commit directly to main.",
  args: {
    workspaceId: tool.schema.string().describe("Workspace ID from github_clone"),
    branchName: tool.schema
      .string()
      .describe("Branch name (e.g., 'fern/add-retry-logic' or 'add-feature')"),
  },
  async execute(args) {
    try {
      const workspace = getWorkspaceById(args.workspaceId);
      if (!workspace) {
        return `Error: Workspace ${args.workspaceId} not found`;
      }

      await createBranch(workspace, args.branchName);
      return `Created branch ${args.branchName} in workspace ${args.workspaceId}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error creating branch: ${message}`;
    }
  },
});
