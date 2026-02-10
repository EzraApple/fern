"use client";

import { formatTokens, formatCost } from "@/lib/format";

interface TokenInfo {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export function TokenSummary({
  tokens,
  cost,
}: {
  tokens: TokenInfo;
  cost: number;
}) {
  return (
    <span
      className="text-xs ml-auto"
      style={{ color: "var(--text-muted)" }}
      title={[
        `Input: ${tokens.input}`,
        `Output: ${tokens.output}`,
        `Reasoning: ${tokens.reasoning}`,
        `Cache read: ${tokens.cache.read}`,
        `Cache write: ${tokens.cache.write}`,
        `Cost: $${cost.toFixed(4)}`,
      ].join("\n")}
    >
      {formatTokens(tokens.input)} in / {formatTokens(tokens.output)} out
      {cost > 0 && ` / ${formatCost(cost)}`}
    </span>
  );
}
