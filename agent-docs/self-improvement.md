---
name: Self-Improvement
description: |
  How Fern modifies its own codebase through controlled PR submissions.
  Reference when: implementing self-modification features, safety boundaries, GitHub integration, coding sub-agent.
---

# Self-Improvement

Fern can modify its own codebase, but only through controlled PR submissions that require human approval.

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

```typescript
async function createCodingWorkspace(repo: string): Promise<string> {
  const workspaceDir = path.join(WORKSPACES_DIR, generateId());

  // Clone repo to isolated directory
  await exec(`git clone ${repo} ${workspaceDir}`);

  // Create feature branch
  await exec(`git checkout -b fern/${generateBranchName()}`, {
    cwd: workspaceDir,
  });

  return workspaceDir;
}
```

## GitHub Integration Tools

### github_clone

```typescript
const githubClone = {
  name: "github_clone",
  description: "Clone a repository to a workspace",
  parameters: z.object({
    repo: z.string().describe("Repository URL or owner/repo"),
  }),
  execute: async (args) => {
    const workspace = await createCodingWorkspace(args.repo);
    return { workspace };
  },
};
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

Special rules when operating on the agent's own repository:

```typescript
const SELF_REPO = process.env.SELF_REPO; // e.g., "EzraApple/fern"

function isSelfRepo(repo: string): boolean {
  return repo.includes(SELF_REPO);
}

// Permission rules for self-repo
const selfRepoPermissions = {
  // Allowed (on branch only)
  read: "allow",
  edit: "allow",
  write: "allow",
  bash: "allow", // for tests
  github_pr: "allow",

  // ALWAYS DENIED
  github_merge: "deny",
  deploy: "deny",
};
```

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

```typescript
async function runImprovement(task: string): Promise<ImprovementResult> {
  // 1. Create isolated workspace
  const workspace = await createCodingWorkspace(SELF_REPO);

  // 2. Spawn coding sub-agent
  const result = await codingSubAgent.execute(task, { workspace });

  // 3. Run tests
  const testResult = await exec("npm test", { cwd: workspace });
  if (!testResult.success) {
    return { success: false, error: "Tests failed" };
  }

  // 4. Open PR
  const pr = await githubPr.execute({
    workspace,
    title: `[Fern] ${task.slice(0, 50)}`,
    body: `
## Summary
${task}

## Changes
${result.filesChanged.map(f => `- ${f}`).join("\n")}

## Testing
- [x] Tests pass locally

---
*This PR was created by Fern self-improvement.*
    `,
  });

  // 5. Record in memory
  await memory_write({
    type: "improvement",
    content: `Created PR #${pr.prNumber}: ${task}`,
    metadata: { prUrl: pr.prUrl },
  });

  return { success: true, prUrl: pr.prUrl };
}
```

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
