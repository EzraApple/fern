# AGENTS.md

Guidance for AI agents working with this repository.

## About Replee

Replee is an AI assistant for software teams that integrates with Linear, Slack, Sentry, and GitHub.

## Building and Testing

```bash
pnpm test            # Run all tests
pnpm tsc             # TypeScript compilation
pnpm lint            # Biome linting
```

## Code Quality

- Use `T[]` for arrays, not `Array<T>`
- Use object parameters for functions with more than one argument
- Use `??` for null coalescing, never `||` for null/undefined fallbacks
- Use descriptive variable names
- Wrap third-party code in try/catch

## Comment Standards

Prefix TODOs with name, date, and ticket number:

```typescript
// TODO (Kevin, 2024-01-15, REPL-1234): Refactor this
// Note (Kevin, 2024-02-10): Workaround for API inconsistency
```

## Trigger.dev MCP Integration

**CRITICAL: Read-Only Mode**

When using Trigger.dev MCP tools, you MUST only use read-only operations. Write operations are strictly prohibited.

### Allowed Read-Only Tools

You may ONLY use these Trigger.dev MCP tools for reading job information and diagnosing failures:

- `list_runs` - List runs with filtering options (status, task, time period, etc.)
- `get_run_details` - Get detailed run information including error traces and logs
- `get_current_worker` - Get task information and payload schema
- `search_docs` - Search Trigger.dev documentation for troubleshooting

### Prohibited Write Operations

**NEVER** use these tools (they modify state):

- `trigger_task` - ❌ DO NOT trigger task runs
- `cancel_run` - ❌ DO NOT cancel runs
- `initialize_project` - ❌ DO NOT initialize new projects
- `deploy` - ❌ DO NOT deploy projects
- `wait_for_run_to_complete` - ❌ DO NOT wait for runs (blocks execution)

### Diagnosing Failed Jobs - Workflow

When asked to investigate why a job failed, follow this workflow:

1. **List failed runs** using `list_runs`:
   ```typescript
   list_runs({
     projectRef: "proj_...",
     status: "FAILED",  // or "CRASHED", "TIMED_OUT", etc.
     limit: 20,
     period: "7d"  // or specific time range
   })
   ```

2. **Get detailed error information** using `get_run_details`:
   ```typescript
   get_run_details({
     runId: "run_...",
     maxTraceLines: 1000  // Get full error trace
   })
   ```

3. **Understand task context** (optional) using `get_current_worker`:
   ```typescript
   get_current_worker({
     projectRef: "proj_...",
     taskId: "task-name"
   })
   ```

4. **Search documentation** (if needed) using `search_docs`:
   ```typescript
   search_docs({ query: "error handling retries" })
   ```

### Usage Guidelines

1. **Only query information** - Use Trigger.dev MCP to read run status, error traces, task definitions, etc.
2. **Never modify state** - Do not trigger tasks, cancel runs, or deploy projects
3. **If asked to perform write operations** - Politely explain that only read-only operations are allowed
