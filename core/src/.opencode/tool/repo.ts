import { tool } from "@opencode-ai/plugin";
import * as git from "@/services/integrations/git.js";
import { withToolTimeout, TOOL_TIMEOUT_MS, LONG_TOOL_TIMEOUT_MS, SETUP_TIMEOUT_MS } from "./utils.js";

// Note (Kevin, 2026-01-06): OpenCode tools that wrap existing Git integration
// All business logic lives in src/services/integrations/git.ts
// All async operations are wrapped with timeouts to prevent hanging

/**
 * Clone repo and create a working branch
 */
export const setup_workspace = tool({
  description: "Clone the repository and create a new branch for making code changes. Returns the workspace path. Read AGENTS.md, README.md, and package.json for setup/testing instructions. Branch naming: use Linear's suggested name if linked to a ticket (e.g., 'kevin/eng-123-fix-bug'), otherwise use 'replee/' prefix (e.g., 'replee/fix-typo').",
  args: {
    branchName: tool.schema.string().describe("Branch name. Use Linear's suggested name if linked to ticket, otherwise use 'replee/' prefix (e.g., 'replee/fix-typo')"),
    repo: tool.schema.string().describe("Repository to clone (owner/repo format)"),
  },
  async execute(args) {
    try {
      // Note (Kevin, 2026-01-07): Wrap sync function in Promise with timeout to prevent hanging
      const result = await withToolTimeout(
        new Promise<ReturnType<typeof git.setupWorkspace>>((resolve, reject) => {
          try {
            resolve(git.setupWorkspace({ repo: args.repo, branchName: args.branchName }));
          } catch (err) {
            reject(err);
          }
        }),
        SETUP_TIMEOUT_MS,
        "repo_setup_workspace"
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Run a git command safely in the workspace
 */
export const run_git = tool({
  description: "Run a git command in the workspace. Dangerous commands (force push, rebase, hard reset) are blocked unless you're on a branch you created.",
  args: {
    workspace: tool.schema.string().describe("Workspace path (returned from setup_workspace)"),
    command: tool.schema.string().describe("Git command to run (without 'git' prefix, e.g., 'checkout -b new-branch' or 'fetch origin')"),
  },
  async execute(args) {
    try {
      const output = git.runGitCommand(args.workspace, args.command);
      return JSON.stringify({
        success: true,
        command: `git ${args.command}`,
        output: output.trim() || "(no output)",
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Commit and push changes
 * Note (Yuxin, 2026-01-11, REPL-21958): Added coAuthorName for GitHub contribution tracking
 * Note (Replee, 2026-01-12, REPL-22053): Simplified to only use coAuthorGitHub for noreply email
 */
export const commit_and_push = tool({
  description: "Commit all changes and push to remote. Runs lint before pushing. Use after making code changes. Add coAuthorName + coAuthorGitHub to give the requester credit in GitHub contributions.",
  args: {
    workspace: tool.schema.string().describe("Workspace path (returned from setup_workspace)"),
    message: tool.schema.string().describe("Commit message"),
    skipLint: tool.schema.boolean().optional().describe("Skip lint check (default: false)"),
    coAuthorName: tool.schema.string().optional().describe("Co-author's full name for GitHub attribution (e.g., 'Kevin O'Connell')"),
    coAuthorGitHub: tool.schema.string().optional().describe("Co-author's GitHub username (e.g., 'kevoconnell'). Constructs noreply email: username@users.noreply.github.com"),
  },
  async execute(args) {
    try {
      // Note (Replee, 2026-01-12, REPL-22053): Always use GitHub noreply format for co-author email
      // Format: username@users.noreply.github.com - this works reliably for GitHub contribution attribution
      const resolvedEmail = args.coAuthorGitHub
        ? `${args.coAuthorGitHub}@users.noreply.github.com`
        : undefined;

      const coAuthor = args.coAuthorName && resolvedEmail
        ? { name: args.coAuthorName, email: resolvedEmail }
        : undefined;
      const result = git.commitAndPush({
        workspace: args.workspace,
        message: args.message,
        skipLint: args.skipLint,
        coAuthor,
      });
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Create a pull request
 * Note (Replee, 2026-01-10): After PR creation, automatically adds @claude review comment
 */
export const create_pr = tool({
  description: "Create a pull request for the current branch",
  args: {
    workspace: tool.schema.string().describe("Workspace path"),
    title: tool.schema.string().describe("PR title"),
    body: tool.schema.string().describe("PR description (markdown)"),
    draft: tool.schema.boolean().optional().describe("Create as draft PR (default: false)"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        git.createPR({
          workspace: args.workspace,
          title: args.title,
          body: args.body,
          draft: args.draft,
        }),
        TOOL_TIMEOUT_MS,
        "repo_create_pr"
      );

      // Note (Replee, 2026-01-10): Add @claude review comment after successful PR creation
      if (result.success && result.prUrl) {
        try {
          await git.addCommentToPR({ workspace: args.workspace, body: "@claude review" });
        } catch {
          // Non-fatal: don't fail PR creation if comment fails
        }
      }

      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Clean up workspace
 */
export const cleanup_workspace = tool({
  description: "Remove the temporary workspace directory. Call this when done with code changes.",
  args: {
    workspace: tool.schema.string().describe("Workspace path to clean up"),
  },
  async execute(args) {
    try {
      const result = git.cleanupWorkspace(args.workspace);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Add reviewers to a PR based on file history (no workspace required)
 */
export const add_pr_reviewers = tool({
  description: "Add reviewers to an existing PR based on who recently touched the affected files. No workspace needed - works with just repo and PR number.",
  args: {
    repo: tool.schema.string().describe("Repository (owner/repo format, e.g., 'replohq/andytown')"),
    prNumber: tool.schema.number().describe("PR number"),
    maxReviewers: tool.schema.number().optional().describe("Maximum reviewers to add (default: 3)"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        git.addPRReviewers({
          repo: args.repo,
          prNumber: args.prNumber,
          maxReviewers: args.maxReviewers,
        }),
        TOOL_TIMEOUT_MS,
        "repo_add_pr_reviewers"
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Add reviewers to a PR based on file history (requires workspace)
 */
export const add_reviewers = tool({
  description: "Add reviewers to a PR based on file history. Requires a cloned workspace. For existing PRs without a workspace, use add_pr_reviewers instead.",
  args: {
    workspace: tool.schema.string().describe("Workspace path"),
    prNumber: tool.schema.number().describe("PR number to add reviewers to"),
    files: tool.schema.array(tool.schema.string()).describe("List of affected file paths (relative to repo root)"),
    maxReviewers: tool.schema.number().optional().describe("Maximum number of reviewers to add (default: 2)"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        git.addReviewersWithWorkspace({
          workspace: args.workspace,
          prNumber: args.prNumber,
          files: args.files,
          maxReviewers: args.maxReviewers,
        }),
        TOOL_TIMEOUT_MS,
        "repo_add_reviewers"
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * Checkout an existing PR for editing
 */
export const checkout_pr = tool({
  description: "Checkout an existing PR's branch to make edits. Use this instead of setup_workspace when you want to edit YOUR OWN PR (not create a new one). After making changes, use commit_and_push to push directly to the PR branch.",
  args: {
    repo: tool.schema.string().describe("Repository (owner/repo format, e.g., 'replohq/andytown')"),
    prNumber: tool.schema.number().describe("PR number to checkout"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        git.checkoutPR({ repo: args.repo, prNumber: args.prNumber }),
        LONG_TOOL_TIMEOUT_MS,
        "repo_checkout_pr"
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});

/**
 * List repositories in the organization
 */
export const list_repos = tool({
  description: "List repositories in the organization. Call this BEFORE setup_workspace if you don't know the exact repo name.",
  args: {
    search: tool.schema.string().optional().describe("Optional search term to filter repos"),
    limit: tool.schema.number().optional().describe("Max repos to return (default: 20)"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        git.listRepos({ search: args.search, limit: args.limit }),
        TOOL_TIMEOUT_MS,
        "repo_list_repos"
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: String(error) });
    }
  },
});
