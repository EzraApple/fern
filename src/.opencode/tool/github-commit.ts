import { commitChanges } from "@/core/workspace-git.js";
import { getWorkspaceById } from "@/core/workspace.js";
import { tool } from "@opencode-ai/plugin";

export const github_commit = tool({
  description:
    "Commit all staged and unstaged changes in the workspace. ALWAYS run tests before committing (e.g., bash: 'cd <workspace_path> && pnpm run lint && pnpm run tsc'). If tests fail, fix the issues first — don't commit broken code. Write clear commit messages that explain what changed and why, not just what files were modified.",
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
