---
name: Implementing Tools
description: |
  How to add new tools to the Fern agent.
  Reference when: adding new tools, classifying read vs write tools, implementing caching, integrating with permissions.
---

# Implementing Tools

## Tool Interface

Every tool follows this structure:

```typescript
import { z } from "zod";

const myTool = {
  name: "my_tool",
  description: "What this tool does - shown to the LLM",
  parameters: z.object({
    path: z.string().describe("Path to the file"),
    options: z.object({
      limit: z.number().optional(),
    }).optional(),
  }),
  execute: async (args, context) => {
    // Implementation
    return {
      success: true,
      output: "Result text shown to LLM",
      metadata: { /* optional structured data */ },
    };
  },
};
```

## Read vs Write Classification

Tools are classified for parallel execution:

| Classification | Parallel? | Examples |
|---------------|-----------|----------|
| **Read** | Yes | `read`, `glob`, `grep`, `web_fetch`, `memory_search`, `schedule_list` |
| **Write** | No (sequential) | `write`, `edit`, `bash` (mutating), `send_message`, `memory_write`, `schedule`, `schedule_cancel` |

### Classifying Your Tool

Ask: "Does this tool have side effects?"

- **No side effects** → Read tool (parallelizable)
- **Modifies state** → Write tool (sequential)

```typescript
const myTool = {
  name: "my_tool",
  classification: "read", // or "write"
  // ...
};
```

## Tool Result Caching

Read tools can be cached to avoid redundant operations:

```typescript
const myTool = {
  name: "my_tool",
  classification: "read",
  cache: {
    enabled: true,
    ttl: 30_000, // 30 seconds
    // Key is auto-generated from tool name + args hash
  },
  // ...
};
```

### Cache Invalidation

Write tools automatically invalidate related read caches:

```typescript
const editTool = {
  name: "edit",
  classification: "write",
  invalidates: ["read"], // Invalidates read cache for same file path
  // ...
};
```

## Permission Integration

Tools respect the unified permission model:

```typescript
const myTool = {
  name: "my_tool",
  // Permission is checked automatically before execute()
  // If denied, tool is not shown to LLM at all
  execute: async (args, context) => {
    // context.permissions.check() available for fine-grained checks
    if (!context.permissions.checkPath(args.path)) {
      return { success: false, error: "Permission denied" };
    }
    // ...
  },
};
```

## Context Object

The execute function receives a context object:

```typescript
interface ToolContext {
  sessionId: string;
  channelId: string;
  userId: string;
  permissions: PermissionChecker;
  abortSignal: AbortSignal;
  memory: MemoryAccess;
}
```

## Example: Adding a Read Tool

```typescript
const listDirectoryTool = {
  name: "list_directory",
  description: "List files in a directory",
  classification: "read",
  cache: { enabled: true, ttl: 60_000 },
  parameters: z.object({
    path: z.string().describe("Directory path"),
    recursive: z.boolean().optional().describe("Include subdirectories"),
  }),
  execute: async (args, context) => {
    const files = await fs.readdir(args.path, {
      recursive: args.recursive,
    });
    return {
      success: true,
      output: files.join("\n"),
      metadata: { count: files.length },
    };
  },
};
```

## Example: Adding a Write Tool

```typescript
const appendFileTool = {
  name: "append_file",
  description: "Append content to a file",
  classification: "write",
  invalidates: ["read", "list_directory"],
  parameters: z.object({
    path: z.string().describe("File path"),
    content: z.string().describe("Content to append"),
  }),
  execute: async (args, context) => {
    if (!context.permissions.checkPath(args.path)) {
      return { success: false, error: "Permission denied for path" };
    }

    await fs.appendFile(args.path, args.content);

    return {
      success: true,
      output: `Appended ${args.content.length} chars to ${args.path}`,
    };
  },
};
```

## Registering Tools

Add tools to the tool registry:

```typescript
// src/tools/index.ts
import { listDirectoryTool } from "./list-directory";
import { appendFileTool } from "./append-file";

export const tools = [
  listDirectoryTool,
  appendFileTool,
  // ... other tools
];
```

## Anti-Patterns

### Don't: Mutate state in a "read" tool

```typescript
// Bad - side effect in read tool
const badTool = {
  name: "get_and_log",
  classification: "read", // Wrong! This has side effects
  execute: async (args) => {
    await logAccess(args.path); // Side effect!
    return await readFile(args.path);
  },
};
```

### Don't: Skip permission checks

```typescript
// Bad - no permission check
const badTool = {
  execute: async (args) => {
    return await fs.writeFile(args.path, args.content); // No check!
  },
};
```

### Don't: Return unstructured output

```typescript
// Bad - hard to parse
return { output: `Error: ${error.message}, File: ${path}` };

// Good - structured
return {
  success: false,
  error: error.message,
  metadata: { path },
};
```
