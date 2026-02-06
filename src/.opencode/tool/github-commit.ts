import { tool } from "@opencode-ai/plugin";
import { commitChanges } from "../../core/workspace-git.js";
import { getWorkspaceById } from "../../core/workspace.js";

export const github_commit = tool({
  description:
    "Commit all changes in the workspace. Creates a commit with the provided message. Make sure to run tests before committing!",
  args: {
    workspaceId: tool.schema.string().describe("Workspace ID from github_clone"),
    message: tool.schema
      .string()
      .describe("Commit message describing the changes (be clear and descriptive)"),
  },
  async execute(args) {
    try {
      const workspace = getWorkspaceById(args.workspaceId);
      if (!workspace) {
        return `Error: Workspace ${args.workspaceId} not found`;
      }

      const commit = await commitChanges(workspace, args.message);
      return `Committed changes in workspace ${args.workspaceId}\nCommit hash: ${commit.hash}\nMessage: ${commit.message}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error committing changes: ${message}`;
    }
  },
});
