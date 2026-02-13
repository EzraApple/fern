import { tool } from "@opencode-ai/plugin";
import { getAuthHeaders, getFernUrl } from "./utils.js";

export const spawn_task = tool({
  description: `Spawn a background subagent to work on a task in parallel. Returns a task ID immediately — the subagent runs in the background.

AGENT TYPES:
- "explore" — Read-only codebase search. Fast (no reasoning). Use for finding files, understanding code structure, tracing dependencies.
- "research" — Web search and synthesis. Use for current events, documentation lookup, API research, best practices.
- "general" — Broad capability including file editing and bash. Use when the task requires writing code, running commands, or multiple capabilities.

WHEN NOT TO USE:
- Simple tasks you can do in 1-2 tool calls — just do them directly.
- Tasks that need conversation context — the subagent has NO memory of this conversation.

PROMPT WRITING:
The subagent gets ONLY the prompt text. Zero context from your conversation. Include everything:
- GOOD: "In /Users/ezra/Projects/fern, find all files that import from @/memory/ and list their paths with a one-line summary of each."
- BAD: "Look at the memory system" (no path, no specifics)
- GOOD: "Search the web for Kimi K2.5 API pricing and supported features as of 2026."
- BAD: "Find out about that model we discussed" (references conversation)

WORKFLOW:
1. spawn_task → get task ID
2. Do your own work (or spawn more tasks)
3. check_task with wait=true when you need the result

DO NOT spawn a single task and immediately block on it — that's slower than doing it yourself. Subagents are for parallelism or context isolation.`,
  args: {
    agentType: tool.schema
      .enum(["explore", "research", "general"])
      .describe(
        "Agent type: explore (read-only code search), research (web search), general (broad)"
      ),
    prompt: tool.schema
      .string()
      .describe(
        "Self-contained prompt for the subagent. Include ALL context — paths, URLs, specifics. The subagent has NO memory of your conversation."
      ),
    parentSessionId: tool.schema.string().describe("Your session ID from the system prompt"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/subagent/spawn`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          agentType: args.agentType,
          prompt: args.prompt,
          parentSessionId: args.parentSessionId,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return `Error spawning task: ${err}`;
      }
      const result = (await res.json()) as { id: string; agentType: string; status: string };
      return `Spawned ${result.agentType} task: ${result.id}\nUse check_task with this ID to get results when ready.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error spawning task: ${msg}`;
    }
  },
});
