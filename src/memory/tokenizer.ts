import type { OpenCodeMessage } from "./types.js";

/**
 * Estimate token count for a single message.
 * Uses OpenCode's token metadata when available, falls back to chars/4 heuristic.
 */
export function estimateMessageTokens(msg: OpenCodeMessage): number {
  // Use OpenCode's token tracking if available
  if (msg.tokens) {
    const { input, output, reasoning } = msg.tokens;
    const total = (input || 0) + (output || 0) + (reasoning || 0);
    if (total > 0) return total;
  }

  // Fallback: estimate from text content
  let textLength = 0;
  for (const part of msg.parts) {
    if (part.text) {
      textLength += part.text.length;
    }
    if (part.state?.input) {
      textLength += JSON.stringify(part.state.input).length;
    }
    if (part.state?.output) {
      textLength += part.state.output.length;
    }
  }

  // Rough heuristic: ~4 characters per token
  return Math.ceil(textLength / 4);
}

/** Estimate total tokens for an array of messages */
export function estimateMessagesTokens(msgs: OpenCodeMessage[]): number {
  let total = 0;
  for (const msg of msgs) {
    total += estimateMessageTokens(msg);
  }
  return total;
}
