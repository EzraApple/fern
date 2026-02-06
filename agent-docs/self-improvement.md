---
name: Self-Improvement
description: |
  How Fern modifies its own codebase through controlled PR submissions.
  Reference when: implementing self-modification features, safety boundaries, GitHub integration, coding sub-agent.
status: Phase 2 Complete - Workspace isolation, GitHub integration, and 6 GitHub tools implemented.
---

# Self-Improvement

Fern can modify its own codebase, but only through controlled PR submissions that require human approval.

**Status: Phase 2 implemented** - All workspace isolation, GitHub integration, and tools are functional.

## Core Safety Principle

**The agent can never directly modify running code.**

All self-modifications:
1. Happen in an isolated workspace (cloned repo)
2. Go through pull requests
3. Require human approval before merge
4. Are tracked in persistent memory

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SELF-IMPROVEMENT FLOW                     │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │  Trigger    │ ──▶│   Coding    │ ──▶│   GitHub    │    │
│  │  (user req, │    │  Sub-Agent  │    │     PR      │    │
│  │   error,    │    │  (isolated) │    │  (human     │    │
│  │   schedule) │    │             │    │   review)   │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│                                               │             │
│                                               ▼             │
│                                        ┌─────────────┐     │
│                                        │   Merge     │     │
│                                        │  (human     │     │
│                                        │   only)     │     │
│                                        └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Coding Sub-Agent

The coding sub-agent is spawned for code modification tasks:

```typescript
interface CodingSubAgent {
  // Isolated workspace
  workspace: string;

  // Available tools (full coding suite)
  tools: ["read", "edit", "write", "glob", "grep", "bash"];

  // Creates branch, makes changes, commits
  execute(task: string): Promise<CodingResult>;
}

interface CodingResult {
  branch: string;
  commits: Commit[];
  filesChanged: string[];
  testsPassed: boolean;
}
```

### Workspace Isolation

**Implementation**: See `src/core/workspace.ts`

```typescript
// Actual implementation in src/core/workspace.ts
export async function createWorkspace(repoUrl: string): Promise<WorkspaceInfo> {
  const workspaceId = ulid(); // Unique ID
  const baseDir = getWorkspaceBaseDir(); // os.tmpdir()/fern-workspaces
  const workspacePath = path.join(baseDir, workspaceId);

  // Create directory and clone
  fs.mkdirSync(workspacePath, { recursive: true });
  await execPromise(`git clone "${repoUrl}" "${workspacePath}"`);

  // Get current branch
  const branchResult = await execPromise("git branch --show-current", {
    cwd: workspacePath,
  });

  const workspace: WorkspaceInfo = {
    id: workspaceId,
    path: workspacePath,
    repoUrl,
    branch: branchResult.stdout.trim(),
    createdAt: Date.now(),
  };

  // Register for cleanup
  workspaceRegistry.set(workspaceId, workspace);
  return workspace;
}
```

**Key features:**
- Workspace location: `os.tmpdir()/fern-workspaces/{ulid}/`
- Auto-cleanup on process exit (registered in `src/index.ts`)
- Stale workspace detection on startup (24-hour TTL)
- Registry tracking for all active workspaces

## GitHub Integration Tools

**Implementation**: See `src/.opencode/tool/github-*.ts`

All 6 GitHub tools are implemented using OpenCode's tool format and auto-discovered at startup.

### github_clone

**File**: `src/.opencode/tool/github-clone.ts`

```typescript
export const github_clone = tool({
  description: "Clone a GitHub repository to an isolated workspace for safe modifications...",
  args: {
    repoUrl: tool.schema.string().describe("Repository URL..."),
  },
  async execute(args) {
    const workspace = await createWorkspace(args.repoUrl);
    return {
      workspaceId: workspace.id,
      path: workspace.path,
      branch: workspace.branch,
      message: `Cloned ${args.repoUrl} to workspace ${workspace.id}`,
      success: true,
    };
  },
});
```

### github_branch

```typescript
const githubBranch = {
  name: "github_branch",
  description: "Create a new branch in the workspace",
  parameters: z.object({
    workspace: z.string(),
    name: z.string().describe("Branch name"),
  }),
  execute: async (args) => {
    await exec(`git checkout -b ${args.name}`, { cwd: args.workspace });
    return { branch: args.name };
  },
};
```

### github_commit

```typescript
const githubCommit = {
  name: "github_commit",
  description: "Commit changes in the workspace",
  parameters: z.object({
    workspace: z.string(),
    message: z.string().describe("Commit message"),
  }),
  execute: async (args) => {
    await exec(`git add -A`, { cwd: args.workspace });
    await exec(`git commit -m "${args.message}"`, { cwd: args.workspace });
    return { committed: true };
  },
};
```

### github_pr

```typescript
const githubPr = {
  name: "github_pr",
  description: "Open a pull request",
  parameters: z.object({
    workspace: z.string(),
    title: z.string(),
    body: z.string(),
  }),
  execute: async (args) => {
    // Push branch
    await exec(`git push -u origin HEAD`, { cwd: args.workspace });

    // Create PR via GitHub API
    const pr = await githubApi.createPullRequest({
      title: args.title,
      body: args.body,
      head: getCurrentBranch(args.workspace),
      base: "main",
    });

    return { prUrl: pr.html_url, prNumber: pr.number };
  },
};
```

### github_pr_status

```typescript
const githubPrStatus = {
  name: "github_pr_status",
  description: "Check PR status (CI, reviews)",
  parameters: z.object({
    prNumber: z.number(),
  }),
  execute: async (args) => {
    const pr = await githubApi.getPullRequest(args.prNumber);
    return {
      state: pr.state,
      mergeable: pr.mergeable,
      ciStatus: pr.status_checks,
      reviews: pr.reviews,
    };
  },
};
```

## Self-Repo Detection

Special rules when operating on the agent's own repository.

**Implementation**: Documented in `config/SYSTEM_PROMPT.md`

The self-repo URL (`https://github.com/EzraApple/fern`) is embedded in the system prompt rather than .env, since the agent will eventually manage multiple repos.

```markdown
## Self-Improvement Workflow

When the user asks you to modify your own codebase (https://github.com/EzraApple/fern):

1. **Clone**: Use `github_clone` to create an isolated workspace
2. **Branch**: Use `github_branch` to create a feature branch (e.g., `fern/add-feature-name`)
3. **Modify**: Use `read`, `write`, `edit` tools to make changes (all confined to workspace)
4. **Test**: Use `bash` to run tests in the workspace (e.g., `pnpm run lint && pnpm run tsc`)
5. **Commit**: Use `github_commit` with a clear commit message
6. **Push**: Use `github_push` to push the branch
7. **PR**: Use `github_pr` to create a pull request with detailed description

**CRITICAL SAFETY RULES:**
- NEVER modify files outside the workspace
- ALWAYS run tests before creating a PR
- NEVER push directly to main branch (branch protection enforces this)
- ALWAYS use PR workflow for self-modifications
- Include clear description of what changed and why in PR body

**Self-Repo Detection:**
When working on https://github.com/EzraApple/fern, this is YOUR codebase. Be extra careful and thorough with testing.
```

**Branch protection** is configured on GitHub (main branch requires PRs and CI checks), so direct pushes to main are blocked at the repository level.

## Improvement Triggers

### 1. User Request

```
User: "Can you add a retry mechanism to the provider gateway?"
Agent: "I'll create a PR for that..."
→ Spawns coding sub-agent
→ Opens PR
→ Reports back with PR URL
```

### 2. Error Analysis

```typescript
async function analyzeRecentErrors(): Promise<ImprovementSuggestion[]> {
  const errors = await getRecentErrors(7 * 24 * 60 * 60 * 1000); // Last 7 days

  const suggestions = await llm.analyze(`
    Review these errors and suggest code improvements:
    ${JSON.stringify(errors)}
  `);

  return suggestions;
}

// Scheduled job
schedule("0 0 * * 0", async () => {
  // Weekly error analysis
  const suggestions = await analyzeRecentErrors();
  if (suggestions.length > 0) {
    await notifyUser(`Found ${suggestions.length} potential improvements`);
  }
});
```

### 3. Scheduled Self-Review

```typescript
schedule("0 0 * * 0", async () => {
  // Weekly self-review
  await agentLoop(`
    Review recent sessions and identify:
    1. Common failure patterns
    2. Performance bottlenecks
    3. Missing capabilities
    4. Documentation gaps

    If you find actionable improvements, create PRs.
  `);
});
```

## Improvement Workflow

The agent follows the workflow documented in the system prompt. Here's an example of the full cycle:

**Example: User requests a feature via WhatsApp**

```
User: "Add a tool that returns a random number between 1 and 100"

Agent workflow:
1. Uses github_clone to clone https://github.com/EzraApple/fern
2. Uses github_branch to create branch "fern/add-random-number-tool"
3. Uses write to create src/.opencode/tool/random-number.ts
4. Uses bash to run: pnpm run lint && pnpm run tsc
5. Uses github_commit with message "Add random number tool"
6. Uses github_push to push the branch
7. Uses github_pr to create PR with title "[Fern] Add random number tool"
   and detailed description of what was added
8. Returns PR URL to user: "Created PR #42: https://github.com/..."

User reviews PR, approves, merges.
Next time agent starts, it has the new tool available!
```

**Testing**: The agent is instructed in the system prompt to run `pnpm run lint && pnpm run tsc` before creating PRs. More comprehensive testing (unit tests, integration tests) will be added in future phases.

**Memory integration** (Phase 3) will allow the agent to remember which PRs it created and track their outcomes for learning.

## Anti-Patterns

### Don't: Allow direct merge

```typescript
// NEVER do this
const githubMerge = {
  name: "github_merge",
  execute: async (args) => {
    await githubApi.mergePullRequest(args.prNumber); // NO!
  },
};
```

### Don't: Modify running code

```typescript
// NEVER do this
await fs.writeFile("./src/core/agent.ts", newCode); // NO!

// Always use isolated workspace
const workspace = await createCodingWorkspace(SELF_REPO);
await fs.writeFile(path.join(workspace, "src/core/agent.ts"), newCode);
```

### Don't: Skip tests

```typescript
// Bad - opens PR without testing
await githubPr.execute({ workspace, title, body });

// Good - run tests first
const testResult = await exec("npm test", { cwd: workspace });
if (!testResult.success) {
  return { success: false, error: "Tests failed" };
}
await githubPr.execute({ workspace, title, body });
```

### Don't: Make sweeping changes without user awareness

```typescript
// Bad - silent large refactor
await runImprovement("Refactor entire codebase to use new patterns");

// Good - notify and get explicit approval for large changes
await notifyUser("I identified a potential refactor. Should I create a PR?");
// Wait for user confirmation
```

## Learning from Outcomes

After a PR is merged (or rejected), record the outcome:

```typescript
async function recordPrOutcome(prNumber: number): Promise<void> {
  const pr = await githubApi.getPullRequest(prNumber);

  await memory_write({
    type: "improvement_outcome",
    content: pr.merged
      ? `PR #${prNumber} was merged. Changes successful.`
      : `PR #${prNumber} was closed without merge. Review feedback: ${pr.review_comments}`,
    metadata: {
      prNumber,
      merged: pr.merged,
      feedback: pr.review_comments,
    },
  });
}
```
