import { createWorkspace } from "@/core/workspace.js";
import { tool } from "@opencode-ai/plugin";

export const github_clone = tool({
  description:
    "Clone a GitHub repository to an isolated workspace for safe modifications. This is always the first step of the self-improvement workflow: clone → branch → modify → test → commit → push → PR. Returns a workspace ID (needed for all subsequent github_* tools) and the workspace path (use this as cwd for read/write/bash). All modifications happen in the workspace — never touch the live codebase.",
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
