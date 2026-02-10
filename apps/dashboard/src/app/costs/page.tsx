"use client";

import { useMemo } from "react";
import { useSessions } from "@/lib/hooks";
import { fetchSessionMessages } from "@/lib/api";
import type { SessionMessage, AssistantMessage } from "@/lib/types";
import { formatTokens, formatCost } from "@/lib/format";
import { DollarSign, ArrowUpRight, ArrowDownRight, Cpu } from "lucide-react";
import useSWR from "swr";

interface SessionCost {
  sessionId: string;
  title: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  messageCount: number;
}

function extractCosts(
  sessionId: string,
  title: string,
  messages: SessionMessage[]
): SessionCost {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;

  for (const msg of messages) {
    if (msg.info.role === "assistant") {
      const info = msg.info as AssistantMessage;
      if (info.tokens) {
        inputTokens += info.tokens.input;
        outputTokens += info.tokens.output;
        reasoningTokens += info.tokens.reasoning;
        cacheRead += info.tokens.cache.read;
        cacheWrite += info.tokens.cache.write;
      }
      cost += info.cost || 0;
    }
  }

  return {
    sessionId,
    title,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheRead,
    cacheWrite,
    cost,
    messageCount: messages.length,
  };
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: typeof DollarSign;
  color: string;
}) {
  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      </div>
      <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

export default function CostsPage() {
  const { data: sessions } = useSessions();

  const sessionIds = useMemo(
    () => (sessions || []).slice(0, 30),
    [sessions]
  );

  const { data: sessionCosts, isLoading } = useSWR(
    sessionIds.length > 0 ? ["session-costs", ...sessionIds.map((s) => s.id)] : null,
    async () => {
      const fetches = sessionIds.map(async (s) => {
        try {
          const msgs = await fetchSessionMessages(s.id);
          return extractCosts(s.id, s.title, msgs);
        } catch {
          return null;
        }
      });
      const results = await Promise.all(fetches);
      return results.filter((r): r is SessionCost => r !== null);
    }
  );

  const totals = useMemo(() => {
    if (!sessionCosts) return null;
    return sessionCosts.reduce(
      (acc, s) => ({
        inputTokens: acc.inputTokens + s.inputTokens,
        outputTokens: acc.outputTokens + s.outputTokens,
        reasoningTokens: acc.reasoningTokens + s.reasoningTokens,
        cost: acc.cost + s.cost,
        sessions: acc.sessions + 1,
      }),
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cost: 0, sessions: 0 }
    );
  }, [sessionCosts]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        Token Usage & Costs
      </h1>

      {isLoading && (
        <p style={{ color: "var(--text-muted)" }}>Loading cost data...</p>
      )}

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Cost"
            value={formatCost(totals.cost)}
            icon={DollarSign}
            color="var(--success)"
          />
          <StatCard
            label="Input Tokens"
            value={formatTokens(totals.inputTokens)}
            icon={ArrowUpRight}
            color="var(--accent)"
          />
          <StatCard
            label="Output Tokens"
            value={formatTokens(totals.outputTokens)}
            icon={ArrowDownRight}
            color="#a855f7"
          />
          <StatCard
            label="Sessions"
            value={String(totals.sessions)}
            icon={Cpu}
            color="var(--warning)"
          />
        </div>
      )}

      {/* Per-session table */}
      {sessionCosts && sessionCosts.length > 0 && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Session
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Input
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Output
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Reasoning
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Cost
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Messages
                </th>
              </tr>
            </thead>
            <tbody>
              {[...sessionCosts]
                .sort((a, b) => b.cost - a.cost)
                .map((sc) => (
                  <tr
                    key={sc.sessionId}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="px-4 py-2">
                      <p className="text-xs truncate max-w-48" style={{ color: "var(--text-primary)" }}>
                        {sc.title || sc.sessionId}
                      </p>
                      <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                        {sc.sessionId.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatTokens(sc.inputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatTokens(sc.outputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                      {formatTokens(sc.reasoningTokens)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                      {formatCost(sc.cost)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                      {sc.messageCount}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
