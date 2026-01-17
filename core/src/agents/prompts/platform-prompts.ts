import type { ChatSource } from "../handlers/types.js";

/**
 * Parameters for building the agent prompt.
 */
export interface BuildPromptParams {
  message: string;
  source: ChatSource;
  context?: string;
  tools?: {
    githubTools?: string[];
    branchName?: string;
  };
}

/**
 * Get platform-specific response instructions.
 */
function getResponseInstructions({ source }: { source: ChatSource }): string {
  if (source.type === "github") {
    const restricted = source.isBotOwnedPR === false
      ? "\nNOT your PR - read-only. To fix: create new branch from PR branch, open PR targeting their branch."
      : "";

    return `GitHub ${source.isPR ? `PR #${source.prNumber}` : `Issue #${source.prNumber}`} in ${source.repo}
${source.filePath ? `File: ${source.filePath}${source.lineNumber ? `:${source.lineNumber}` : ""}` : ""}${restricted}
Use markdown. Reference specific files/lines. Keep responses actionable.`;
  }

  return "";
}

/**
 * Build the full prompt for the agent including context and instructions.
 */
export function buildPrompt({ message, source, context, tools }: BuildPromptParams): string {
  const responseInstructions = getResponseInstructions({ source });
  const repoFromSource = source.repo;

  const githubContext =
    source.type === "github" && source.repo && source.prNumber
      ? `## GitHub Context
${source.repo} PR #${source.prNumber}${source.prBranch ? ` (${source.prBranch}${source.prBaseBranch ? ` → ${source.prBaseBranch}` : ""})` : ""}`
      : "";

  const isPRComment = source.type === "github" && source.isPR && source.prNumber;
  const repoInstructions = isPRComment
    ? `## Code Access
1. \`repo_checkout_pr({ repo: "${repoFromSource}", prNumber: ${source.prNumber} })\` - checks out the PR branch (${source.prBranch ?? "unknown"})
2. Use ABSOLUTE paths with returned workspace path
3. Make changes, commit, and push to the EXISTING PR branch
4. Do NOT create a new PR - push directly to the existing branch`
    : `## Code Access
1. \`repo_setup_workspace({ repo: "${repoFromSource ?? "owner/repo"}", branchName: "${tools?.branchName ?? "jarvis/fix"}" })\`
2. Use ABSOLUTE paths with returned workspace path`;

  return `## Request
${message}
${context ? `\n## Context\n${context}` : ""}
${githubContext}

${repoInstructions}

## Response
${responseInstructions}`;
}
