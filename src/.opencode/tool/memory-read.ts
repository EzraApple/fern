import { tool } from "@opencode-ai/plugin";

function getFernUrl(): string {
  return process.env.FERN_API_URL || `http://127.0.0.1:${process.env.FERN_PORT || "4000"}`;
}

interface ChunkMessage {
  role: string;
  parts: Array<{
    type: string;
    text?: string;
    tool?: string;
    state?: {
      status?: string;
      input?: unknown;
      output?: string;
    };
  }>;
}

interface ArchiveChunk {
  id: string;
  threadId: string;
  summary: string;
  messageCount: number;
  tokenCount: number;
  messageRange: {
    firstTimestamp: number;
    lastTimestamp: number;
  };
  messages: ChunkMessage[];
}

/** Format a chunk's messages into a readable transcript */
function formatChunkMessages(chunk: ArchiveChunk): string {
  const lines: string[] = [
    `## Archived Chunk: ${chunk.id}`,
    `Thread: ${chunk.threadId}`,
    `Messages: ${chunk.messageCount} | Tokens: ~${chunk.tokenCount}`,
    `Time: ${new Date(chunk.messageRange.firstTimestamp).toISOString()} to ${new Date(chunk.messageRange.lastTimestamp).toISOString()}`,
    "",
    "### Summary",
    chunk.summary,
    "",
    "### Full Transcript",
    "",
  ];

  for (const msg of chunk.messages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`**[${role}]**`);

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text);
      } else if (part.type === "tool" && part.tool) {
        const status = part.state?.status ?? "unknown";
        lines.push(`\`[Tool: ${part.tool}]\` (${status})`);
        if (part.state?.input) {
          const inputStr = JSON.stringify(part.state.input);
          lines.push(
            `  Input: ${inputStr.length > 500 ? `${inputStr.slice(0, 500)}...` : inputStr}`
          );
        }
        if (part.state?.output) {
          lines.push(
            `  Output: ${part.state.output.length > 500 ? `${part.state.output.slice(0, 500)}...` : part.state.output}`
          );
        }
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export const memory_read = tool({
  description:
    "Read the full original messages from an archived conversation chunk. Use after memory_search to get exact details from a relevant chunk. Returns the complete message transcript that was summarized.",
  args: {
    chunkId: tool.schema.string().describe("The chunk ID from memory_search results"),
    threadId: tool.schema.string().describe("The thread ID from memory_search results"),
  },
  async execute(args) {
    try {
      const res = await fetch(`${getFernUrl()}/internal/memory/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: args.threadId,
          chunkId: args.chunkId,
        }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          return `Chunk ${args.chunkId} not found for thread ${args.threadId}.`;
        }
        const err = await res.text();
        return `Error reading chunk: ${err}`;
      }
      const chunk = (await res.json()) as ArchiveChunk;
      return formatChunkMessages(chunk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading chunk: ${msg}`;
    }
  },
});
