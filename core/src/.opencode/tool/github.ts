import { tool } from "@opencode-ai/plugin";
import * as github from "@/services/integrations/github.js";
import { withToolTimeout, TOOL_TIMEOUT_MS } from "./utils.js";

// Note (Kevin, 2026-01-06): OpenCode tools that wrap existing GitHub integration
// All actual API logic lives in src/services/integrations/github.ts
// All async operations are wrapped with timeouts to prevent hanging

export const get_pr_review_comments = tool({
  description: "Get all inline review comments on a PR",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
  },
  async execute(args) {
    try {
      const comments = await withToolTimeout(
        github.getReviewCommentsByRepo(args),
        TOOL_TIMEOUT_MS,
        "github_get_pr_review_comments"
      );
      return JSON.stringify({ success: true, count: comments.length, comments }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const get_pr_comments = tool({
  description: "Get all comments on a PR",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
  },
  async execute(args) {
    try {
      const comments = await withToolTimeout(
        github.getCommentsByRepo(args),
        TOOL_TIMEOUT_MS,
        "github_get_pr_comments"
      );
      return JSON.stringify({ success: true, count: comments.length, comments }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const create_repo = tool({
  description: "Create a new GitHub repository",
  args: {
    name: tool.schema.string().describe("Repository name"),
    org: tool.schema.string().optional().describe("Organization name"),
    description: tool.schema.string().optional().describe("Repository description"),
    isPrivate: tool.schema.boolean().optional().describe("Make private (default: true)"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        github.createRepo({ ...args, private: args.isPrivate }),
        TOOL_TIMEOUT_MS,
        "github_create_repo"
      );
      return JSON.stringify({ success: true, ...result }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const fork_repo = tool({
  description: "Fork a repository",
  args: {
    repo: tool.schema.string().describe("Repository to fork (owner/repo format)"),
    org: tool.schema.string().optional().describe("Organization to fork to"),
    name: tool.schema.string().optional().describe("Custom name for the fork"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        github.forkRepo(args.repo, { org: args.org, name: args.name }),
        TOOL_TIMEOUT_MS,
        "github_fork_repo"
      );
      return JSON.stringify({ success: true, ...result, forkedFrom: args.repo }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const list_repos = tool({
  description: "Search/list repositories for a user or organization. Uses GitHub search API for faster results. Supports pagination.",
  args: {
    org: tool.schema.string().optional().describe("User or org name (e.g., 'replohq')"),
    search: tool.schema.string().optional().describe("Search query to filter repos (e.g., 'andytown' or 'replee')"),
    limit: tool.schema.number().optional().describe("Maximum repos per page (default: 30)"),
    page: tool.schema.number().optional().describe("Page number for pagination (default: 1)"),
    visibility: tool.schema.enum(["public", "private", "all"]).optional().describe("Filter by visibility"),
  },
  async execute(args) {
    try {
      const result = await withToolTimeout(
        github.listRepos(args),
        TOOL_TIMEOUT_MS,
        "github_list_repos"
      );
      return JSON.stringify({
        success: true,
        count: result.repos.length,
        total: result.total,
        page: result.page,
        hasNextPage: result.hasNextPage,
        repos: result.repos,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const create_pr = tool({
  description: "Create a pull request on GitHub. Use this when you have already pushed a branch and want to open a PR.",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format (e.g., 'replohq/andytown')"),
    title: tool.schema.string().describe("PR title"),
    body: tool.schema.string().describe("PR description (markdown supported)"),
    head: tool.schema.string().describe("Branch name containing the changes"),
    base: tool.schema.string().optional().describe("Target branch (default: 'main')"),
    draft: tool.schema.boolean().optional().describe("Create as draft PR (default: false)"),
  },
  async execute(args) {
    try {
      const octokit = github.getOctokit();
      const [owner, repo] = args.repo.split("/");
      if (!owner || !repo) {
        return JSON.stringify({ success: false, error: "Invalid repo format. Use owner/repo" });
      }
      const { data } = await withToolTimeout(
        octokit.rest.pulls.create({
          owner,
          repo,
          title: args.title,
          body: args.body,
          head: args.head,
          base: args.base ?? "main",
          draft: args.draft ?? false,
        }),
        TOOL_TIMEOUT_MS,
        "github_create_pr"
      );
      return JSON.stringify({
        success: true,
        prNumber: data.number,
        url: data.html_url,
        title: data.title,
        state: data.state,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const get_pr = tool({
  description: "Get details about a pull request",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
  },
  async execute(args) {
    try {
      const pr = await withToolTimeout(
        github.getPRByRepo({ repo: args.repo, prNumber: args.prNumber }),
        TOOL_TIMEOUT_MS,
        "github_get_pr"
      );
      return JSON.stringify({ success: true, ...pr }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const request_reviewers = tool({
  description: "Request reviewers for a pull request",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
    reviewers: tool.schema.array(tool.schema.string()).describe("List of GitHub usernames to request review from"),
  },
  async execute(args) {
    try {
      await withToolTimeout(
        github.requestReviewersByRepo({
          repo: args.repo,
          prNumber: args.prNumber,
          reviewers: args.reviewers,
        }),
        TOOL_TIMEOUT_MS,
        "github_request_reviewers"
      );
      return JSON.stringify({
        success: true,
        message: `Requested review from ${args.reviewers.join(", ")}`,
        prNumber: args.prNumber,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const add_inline_comment = tool({
  description: "Add a single inline comment to a specific line or range of lines in a PR. Use this to leave feedback on a specific piece of code.",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
    path: tool.schema.string().describe("File path relative to repo root (e.g., 'src/index.ts')"),
    line: tool.schema.number().describe("Line number to comment on (for multi-line, this is the end line)"),
    body: tool.schema.string().describe("Comment text (markdown supported)"),
    startLine: tool.schema.number().optional().describe("Start line for multi-line comment (omit for single-line)"),
  },
  async execute(args) {
    try {
      const comment = await withToolTimeout(
        github.addInlineCommentByRepo({
          repo: args.repo,
          prNumber: args.prNumber,
          path: args.path,
          line: args.line,
          body: args.body,
          startLine: args.startLine,
        }),
        TOOL_TIMEOUT_MS,
        "github_add_inline_comment"
      );
      return JSON.stringify({
        success: true,
        commentId: comment.id,
        path: comment.path,
        line: comment.line,
        startLine: comment.startLine,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const create_review = tool({
  description: "Create a PR review with inline code comments. Use this to leave feedback on multiple lines of code at once.",
  args: {
    repo: tool.schema.string().describe("Repository in owner/repo format"),
    prNumber: tool.schema.number().describe("PR number"),
    body: tool.schema.string().optional().describe("Overall review summary comment"),
    comments: tool.schema.array(
      tool.schema.object({
        path: tool.schema.string().describe("File path"),
        line: tool.schema.number().describe("Line number"),
        body: tool.schema.string().describe("Comment text"),
        startLine: tool.schema.number().optional().describe("Start line for multi-line"),
      })
    ).describe("Array of inline comments"),
  },
  async execute(args) {
    try {
      const octokit = github.getOctokit();
      const [owner, repo] = args.repo.split("/");
      if (!owner || !repo) {
        return JSON.stringify({ success: false, error: "Invalid repo format. Use owner/repo" });
      }

      const { data } = await withToolTimeout(
        octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: args.prNumber,
          event: "COMMENT",
          body: args.body,
          comments: args.comments?.map((c) => ({
            path: c.path,
            body: c.body,
            line: c.line,
            start_line: c.startLine,
            side: "RIGHT" as const,
          })),
        }),
        TOOL_TIMEOUT_MS,
        "github_create_review"
      );

      return JSON.stringify({
        success: true,
        reviewId: data.id,
        url: data.html_url,
        commentsAdded: args.comments?.length ?? 0,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});

export const create_gist = tool({
  description: "Create a GitHub gist to share files",
  args: {
    filename: tool.schema.string().describe("Filename with extension"),
    content: tool.schema.string().describe("File content"),
    description: tool.schema.string().optional().describe("Description"),
    isPublic: tool.schema.boolean().optional().describe("Public gist (default: false)"),
  },
  async execute(args) {
    try {
      const octokit = github.getOctokit();
      const { data } = await withToolTimeout(
        octokit.rest.gists.create({
          description: args.description,
          public: args.isPublic ?? false,
          files: { [args.filename]: { content: args.content } },
        }),
        TOOL_TIMEOUT_MS,
        "github_create_gist"
      );
      return JSON.stringify({ success: true, url: data.html_url, filename: args.filename }, null, 2);
    } catch (error) {
      return JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
});
