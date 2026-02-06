import { tool } from "@opencode-ai/plugin";
import { createWorkspace } from "../../core/workspace.js";

export const github_clone = tool({
  description:
    "Clone a GitHub repository to an isolated workspace for safe modifications. Returns workspace ID and path. All file modifications must be done in this workspace, never in the live codebase.",
  args: {
    repoUrl: tool.schema
      .string()
      .describe("Repository URL (e.g., https://github.com/owner/repo or owner/repo)"),
  },
  async execute(args) {
    try {
      const workspace = await createWorkspace(args.repoUrl);
      return `Cloned ${args.repoUrl} to workspace ${workspace.id} at ${workspace.path}\nCurrent branch: ${workspace.branch}\nWorkspace ID: ${workspace.id}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error cloning repository: ${message}`;
    }
  },
});
