"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSessions, useTools } from "@/lib/hooks";
import { fetchSessionMessages } from "@/lib/api";
import type { SessionMessage, ToolPart } from "@/lib/types";
import { formatDuration, relativeTime, fullDateTime } from "@/lib/format";
import {
  Wrench,
  CheckCircle,
  XCircle,
  Loader,
  X,
  Clock,
} from "lucide-react";
import useSWR from "swr";

interface ToolExecution {
  tool: string;
  status: string;
  duration: number | null;
  sessionId: string;
  timestamp: number;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
}

function extractToolExecutions(
  sessionId: string,
  messages: SessionMessage[]
): ToolExecution[] {
  const executions: ToolExecution[] = [];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool") {
        const tp = part as ToolPart;
        let duration: number | null = null;
        let timestamp = 0;
        if ("time" in tp.state && tp.state.time) {
          timestamp = tp.state.time.start;
          if ("end" in tp.state.time) {
            duration = tp.state.time.end - tp.state.time.start;
          }
        }
        executions.push({
          tool: tp.tool,
          status: tp.state.status,
          duration,
          sessionId,
          timestamp,
          input: tp.state.input,
          output: "output" in tp.state ? tp.state.output : undefined,
          error: "error" in tp.state ? tp.state.error : undefined,
        });
      }
    }
  }
  return executions;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle size={14} style={{ color: "var(--success)" }} />;
    case "error":
      return <XCircle size={14} style={{ color: "var(--error)" }} />;
    case "running":
      return <Loader size={14} className="animate-spin" style={{ color: "var(--warning)" }} />;
    default:
      return <Clock size={14} style={{ color: "var(--text-muted)" }} />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    completed: { bg: "rgba(34,197,94,0.15)", text: "var(--success)" },
    error: { bg: "rgba(239,68,68,0.15)", text: "var(--error)" },
    running: { bg: "rgba(234,179,8,0.15)", text: "var(--warning)" },
    pending: { bg: "rgba(115,115,115,0.15)", text: "var(--text-muted)" },
  };
  const c = colors[status] || colors.pending;
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status}
    </span>
  );
}

function ToolDetailModal({
  exec,
  onClose,
}: {
  exec: ToolExecution;
  onClose: () => void;
}) {
  // Close on Escape key + lock body scroll
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl border shadow-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderColor: "var(--border)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-md transition-colors z-10"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <StatusIcon status={exec.status} />
            <span
              className="text-base font-mono font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {exec.tool}
            </span>
            <StatusBadge status={exec.status} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {exec.duration !== null && <span>Duration: {formatDuration(exec.duration)}</span>}
            {exec.timestamp > 0 && (
              <span title={fullDateTime(exec.timestamp)}>
                {relativeTime(exec.timestamp)}
              </span>
            )}
            <span>Session: {exec.sessionId.slice(0, 12)}</span>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Input */}
          {exec.input && Object.keys(exec.input).length > 0 && (
            <div>
              <p
                className="text-xs font-medium mb-2"
                style={{ color: "var(--text-muted)" }}
              >
                Input
              </p>
              <pre
                className="text-xs p-3 rounded-lg overflow-x-auto max-h-60 overflow-y-auto"
                style={{
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {JSON.stringify(exec.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {exec.output && (
            <div>
              <p
                className="text-xs font-medium mb-2"
                style={{ color: "var(--text-muted)" }}
              >
                Output
              </p>
              <pre
                className="text-xs p-3 rounded-lg overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap"
                style={{
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {exec.output}
              </pre>
            </div>
          )}

          {/* Error */}
          {exec.error && (
            <div>
              <p
                className="text-xs font-medium mb-2"
                style={{ color: "var(--error)" }}
              >
                Error
              </p>
              <pre
                className="text-xs p-3 rounded-lg overflow-x-auto"
                style={{
                  backgroundColor: "rgba(239,68,68,0.1)",
                  color: "var(--error)",
                }}
              >
                {exec.error}
              </pre>
            </div>
          )}

          {/* Empty state */}
          {!exec.output && !exec.error && Object.keys(exec.input).length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No input/output data available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { data: sessions } = useSessions();
  const { data: toolNames } = useTools();
  const [toolFilter, setToolFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedExec, setSelectedExec] = useState<ToolExecution | null>(null);

  const handleClose = useCallback(() => setSelectedExec(null), []);

  // Load messages for all sessions and extract tool calls
  const sessionIds = useMemo(
    () => (sessions || []).slice(0, 20).map((s) => s.id),
    [sessions]
  );

  const { data: allExecutions, isLoading } = useSWR(
    sessionIds.length > 0 ? ["tool-executions", ...sessionIds] : null,
    async () => {
      const results: ToolExecution[] = [];
      const fetches = sessionIds.map(async (id) => {
        try {
          const msgs = await fetchSessionMessages(id);
          return extractToolExecutions(id, msgs);
        } catch {
          return [];
        }
      });
      const all = await Promise.all(fetches);
      for (const execs of all) results.push(...execs);
      return results.sort((a, b) => b.timestamp - a.timestamp);
    }
  );

  const filtered = useMemo(() => {
    if (!allExecutions) return [];
    return allExecutions.filter((e) => {
      if (toolFilter && e.tool !== toolFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      return true;
    });
  }, [allExecutions, toolFilter, statusFilter]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        Tool Execution Analytics
      </h1>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md text-sm border outline-none"
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">All tools</option>
          {toolNames?.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md text-sm border outline-none"
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
        </select>
      </div>

      {isLoading && (
        <p style={{ color: "var(--text-muted)" }}>Loading tool executions...</p>
      )}

      {filtered.length > 0 && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Tool
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Status
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Duration
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Session
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((exec, i) => (
                <tr
                  key={`${exec.sessionId}-${exec.timestamp}-${i}`}
                  className="border-t cursor-pointer transition-colors"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setSelectedExec(exec)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                    <div className="flex items-center gap-2">
                      <Wrench size={12} style={{ color: "var(--text-muted)" }} />
                      {exec.tool}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      {exec.status === "completed" && (
                        <CheckCircle size={12} style={{ color: "var(--success)" }} />
                      )}
                      {exec.status === "error" && (
                        <XCircle size={12} style={{ color: "var(--error)" }} />
                      )}
                      {exec.status === "running" && (
                        <Loader size={12} className="animate-spin" style={{ color: "var(--warning)" }} />
                      )}
                      <span
                        className="text-xs"
                        style={{
                          color:
                            exec.status === "completed"
                              ? "var(--success)"
                              : exec.status === "error"
                                ? "var(--error)"
                                : "var(--text-secondary)",
                        }}
                      >
                        {exec.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {exec.duration !== null ? formatDuration(exec.duration) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {exec.sessionId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {exec.timestamp > 0 ? relativeTime(exec.timestamp) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && filtered.length === 0 && allExecutions && (
        <p style={{ color: "var(--text-muted)" }}>No tool executions found.</p>
      )}

      {/* Tool detail modal */}
      {selectedExec && (
        <ToolDetailModal exec={selectedExec} onClose={handleClose} />
      )}
    </div>
  );
}
