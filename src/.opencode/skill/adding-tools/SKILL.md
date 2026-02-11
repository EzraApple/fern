---
name: adding-tools
description: How to create new OpenCode tools for the Fern agent. Reference when implementing executable actions using the OpenCode plugin format or the HTTP proxy pattern for native modules.
---

# Adding Tools

Tools are executable actions the agent can call. They are TypeScript files in `src/.opencode/tool/` using the OpenCode plugin format, auto-discovered at startup.

## Simple tool (no native modules)

```typescript
import { tool } from "@opencode-ai/plugin";

export const my_tool = tool({
  description: "What this tool does — shown to the LLM to decide when to use it",
  args: {
    input: tool.schema.string().describe("What this argument is"),
    count: tool.schema.number().optional().describe("Optional number"),
  },
  async execute(args) {
    // Implementation here
    return "Result string shown to LLM";
  },
});
```

Key rules:
- File goes in `src/.opencode/tool/` (auto-discovered, no registry needed)
- The export name becomes the tool name (`my_tool` → tool called `my_tool`)
- Use `tool.schema` for argument schemas (Zod-compatible)
- Return a string or JSON-serializable object
- One or more tools per file is fine

## Argument types

```typescript
args: {
  // String
  name: tool.schema.string().describe("..."),

  // Number
  count: tool.schema.number().describe("..."),

  // Boolean
  force: tool.schema.boolean().describe("..."),

  // Enum
  type: tool.schema.enum(["fact", "preference", "learning"]).describe("..."),

  // Optional
  tags: tool.schema.array(tool.schema.string()).optional().describe("..."),
}
```

## HTTP proxy pattern (for native modules)

OpenCode tools run inside OpenCode's embedded Go binary JS runtime. This runtime **cannot** load native Node modules like `better-sqlite3`, `node:sqlite`, etc.

When a tool needs native module access, use `fetch()` to call internal Fern server endpoints:

```
OpenCode Runtime (sandboxed)         Fern Server (full Node.js)
┌─────────────────────┐              ┌─────────────────────┐
│  tool calls fetch() │──HTTP──────→ │ /internal/my-api    │
└─────────────────────┘              └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │  Native modules     │
                                     │  (SQLite, etc.)     │
                                     └─────────────────────┘
```

### Tool side (in `src/.opencode/tool/`)

```typescript
import { tool } from "@opencode-ai/plugin";

function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || "4000"}`;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.FERN_API_SECRET;
  if (secret) {
    headers["X-Fern-Secret"] = secret;
  }
  return headers;
}

export const my_tool = tool({
  description: "Does something that needs native modules",
  args: {
    data: tool.schema.string().describe("Input data"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/my-feature/action`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ data: args.data }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error: ${err}`;
      }
      const result = await res.json();
      return `Success: ${JSON.stringify(result)}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: ${msg}`;
    }
  },
});
```

### Server side (in `src/server/`)

1. Create API handler (e.g., `src/server/my-feature-api.ts`)
2. Mount routes in `src/server/server.ts` under `/internal/my-feature/*`
3. Internal routes are protected by `FERN_API_SECRET` auth middleware

See `src/server/memory-api.ts` and `src/server/scheduler-api.ts` for examples.

## Anti-patterns

### Don't import native modules in tools

```typescript
// BAD — will fail in OpenCode's sandboxed runtime
import Database from "better-sqlite3";

// GOOD — use HTTP proxy
const res = await fetch(`${getFernUrl()}/internal/db/query`, { ... });
```

### Don't hardcode server URLs

```typescript
// BAD
const res = await fetch("http://localhost:4000/internal/...");

// GOOD
const res = await fetch(`${getFernUrl()}/internal/...`);
```

### Don't register tools manually

```typescript
// BAD — tools are auto-discovered, no registry
export const tools = [myTool, otherTool];

// GOOD — just export from a file in src/.opencode/tool/
export const my_tool = tool({ ... });
```

## Current tools

| Tool | File | Uses HTTP Proxy? |
|------|------|-----------------|
| `echo` | `echo.ts` | No |
| `time` | `time.ts` | No |
| `github_clone` | `github-clone.ts` | No |
| `github_branch` | `github-branch.ts` | No |
| `github_commit` | `github-commit.ts` | No |
| `github_push` | `github-push.ts` | No |
| `github_pr` | `github-pr.ts` | Yes |
| `github_pr_status` | `github-pr-status.ts` | Yes |
| `memory_write` | `memory-write.ts` | Yes |
| `memory_search` | `memory-search.ts` | Yes |
| `memory_read` | `memory-read.ts` | Yes |
| `schedule` | `schedule.ts` | Yes |
| `schedule_list` / `schedule_cancel` | `schedule-manage.ts` | Yes |
| `send_message` | `send-message.ts` | Yes |

Plus built-in OpenCode tools: `read`, `edit`, `write`, `bash`, `glob`, `grep`.

## Checklist for adding a new tool

1. Decide: does it need native modules? If yes, use HTTP proxy pattern.
2. Create file in `src/.opencode/tool/<tool-name>.ts`
3. Export a named `tool()` call
4. Write clear `description` (the LLM reads this to decide when to use the tool)
5. Define `args` with descriptive `.describe()` on each
6. If using HTTP proxy: create internal API endpoint, mount in `server.ts`
7. Include `getAuthHeaders()` if calling internal APIs
8. Handle errors gracefully — return error strings, don't throw
9. Restart OpenCode to pick up the new tool
