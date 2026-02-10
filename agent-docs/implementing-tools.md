---
name: Implementing Tools
description: |
  How to add new tools to the Fern agent using OpenCode's plugin format.
  Reference when: adding new tools, understanding the HTTP proxy pattern for native modules.
---

# Implementing Tools

## Tool Format (OpenCode Plugin)

Tools are defined in `src/.opencode/tool/` using the OpenCode plugin format and are auto-discovered at startup (no registry needed):

```typescript
import { tool } from "@opencode-ai/plugin";

export const my_tool = tool({
  description: "What this tool does - shown to the LLM",
  args: {
    path: tool.schema.string().describe("Path to the file"),
    limit: tool.schema.number().optional().describe("Max results"),
  },
  async execute(args) {
    // Implementation
    return "Result text shown to LLM";
  },
});
```

Key points:
- Export a named `tool()` call — the export name becomes the tool name
- Use `tool.schema` (Zod-compatible) for argument schemas
- Return a string (shown to LLM) or a JSON-serializable object
- File must be in `src/.opencode/tool/` for auto-discovery

## HTTP Proxy Pattern

OpenCode tools run inside OpenCode's embedded Go binary JS runtime, which **cannot** load native Node modules (`better-sqlite3`, `node:sqlite`, etc.). Tools that need native module access use `fetch()` to call internal Fern server endpoints:

```
OpenCode Runtime (Go binary)          Fern Server (Node.js)
┌────────────────────────┐            ┌────────────────────────┐
│  memory_write tool     │──fetch()──→│ /internal/memory/write │
│  schedule tool         │──fetch()──→│ /internal/scheduler/*  │
│  send_message tool     │──fetch()──→│ /internal/channel/send │
└────────────────────────┘            └─────────┬──────────────┘
                                                │
                                      ┌─────────▼──────────────┐
                                      │  better-sqlite3        │
                                      │  + sqlite-vec          │
                                      │  + native modules      │
                                      └────────────────────────┘
```

### URL Resolution

Tools resolve the Fern server URL via environment variable:

```typescript
function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || 4000}`;
}
```

### Example: Tool with HTTP Proxy

```typescript
import { tool } from "@opencode-ai/plugin";

function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || 4000}`;
}

export const memory_write = tool({
  description: "Save a persistent memory (fact, preference, or learning)",
  args: {
    type: tool.schema.enum(["fact", "preference", "learning"]).describe("Memory type"),
    content: tool.schema.string().describe("What to remember"),
    tags: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
  },
  async execute(args) {
    const res = await fetch(`${getFernUrl()}/internal/memory/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Memory write failed: ${res.status}`);
    const data = await res.json();
    return `Memory saved: ${data.id} [${args.type}] ${args.content.slice(0, 80)}...`;
  },
});
```

### Example: Simple Tool (No Native Modules)

```typescript
import { tool } from "@opencode-ai/plugin";

export const time = tool({
  description: "Get the current date and time",
  args: {},
  async execute() {
    return new Date().toISOString();
  },
});
```

## Current Tools

| Tool | File | Category | Uses HTTP Proxy? |
|------|------|----------|-----------------|
| `echo` | `echo.ts` | Basic | No |
| `time` | `time.ts` | Basic | No |
| `github_clone` | `github-clone.ts` | GitHub | No (shell commands) |
| `github_branch` | `github-branch.ts` | GitHub | No |
| `github_commit` | `github-commit.ts` | GitHub | No |
| `github_push` | `github-push.ts` | GitHub | No |
| `github_pr` | `github-pr.ts` | GitHub | Yes (`/internal/...`) |
| `github_pr_status` | `github-pr-status.ts` | GitHub | Yes |
| `memory_write` | `memory-write.ts` | Memory | Yes (`/internal/memory/*`) |
| `memory_search` | `memory-search.ts` | Memory | Yes |
| `memory_read` | `memory-read.ts` | Memory | Yes |
| `schedule` | `schedule.ts` | Scheduling | Yes (`/internal/scheduler/*`) |
| `schedule_list` / `schedule_cancel` | `schedule-manage.ts` | Scheduling | Yes |
| `send_message` | `send-message.ts` | Messaging | Yes (`/internal/channel/*`) |

Plus built-in OpenCode tools: `read`, `edit`, `write`, `bash`, `glob`, `grep`.

## Adding Internal API Endpoints

If your tool needs server-side logic (e.g., database access), add an internal API endpoint:

1. Create the API handler in `src/server/` (e.g., `my-api.ts`)
2. Mount it in `src/server/server.ts` under `/internal/my-feature/*`
3. Have the tool call the endpoint via `fetch()`

See `src/server/memory-api.ts` and `src/server/scheduler-api.ts` for examples.

## Anti-Patterns

### Don't: Import native modules in tools

```typescript
// Bad - native module won't load in OpenCode's runtime
import Database from "better-sqlite3";

// Good - use HTTP proxy to fern server
const res = await fetch(`${getFernUrl()}/internal/memory/write`, { ... });
```

### Don't: Hardcode server URLs

```typescript
// Bad
const res = await fetch("http://localhost:4000/internal/...");

// Good
const res = await fetch(`${getFernUrl()}/internal/...`);
```

### Don't: Use a manual tool registry

```typescript
// Bad - tools are auto-discovered, no registry needed
export const tools = [myTool, otherTool];

// Good - just export from a file in src/.opencode/tool/
export const my_tool = tool({ ... });
```
