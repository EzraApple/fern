"use client";

import { formatDuration } from "@/lib/format";
import type { ToolPart as ToolPartType } from "@/lib/types";
import { CheckCircle, ChevronDown, ChevronRight, Clock, Loader, XCircle } from "lucide-react";
import { useState } from "react";

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

export function ToolCallPart({ part }: { part: ToolPartType }) {
  const { tool, state } = part;
  const defaultOpen = state.status === "running" || state.status === "error";
  const [open, setOpen] = useState(defaultOpen);

  const duration =
    "time" in state && state.time && "end" in state.time
      ? formatDuration(state.time.end - state.time.start)
      : "time" in state && state.time
        ? "running..."
        : null;

  return (
    <div
      className="rounded-md border"
      style={{
        backgroundColor: "var(--bg-tertiary)",
        borderColor: "var(--border)",
      }}
    >
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
        )}
        <StatusIcon status={state.status} />
        <span className="text-xs font-mono font-medium" style={{ color: "var(--text-primary)" }}>
          {tool}
        </span>
        <StatusBadge status={state.status} />
        {duration && (
          <span className="text-xs ml-auto" style={{ color: "var(--text-muted)" }}>
            {duration}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: "var(--border)" }}>
          {/* Input */}
          {state.input && Object.keys(state.input).length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Input
              </p>
              <pre
                className="text-xs p-2 rounded overflow-x-auto max-h-60 overflow-y-auto"
                style={{
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {JSON.stringify(state.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {"output" in state && state.output && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Output
              </p>
              <pre
                className="text-xs p-2 rounded overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap"
                style={{
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-secondary)",
                }}
              >
                {state.output}
              </pre>
            </div>
          )}

          {/* Error */}
          {"error" in state && state.error && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--error)" }}>
                Error
              </p>
              <pre
                className="text-xs p-2 rounded overflow-x-auto"
                style={{
                  backgroundColor: "rgba(239,68,68,0.1)",
                  color: "var(--error)",
                }}
              >
                {state.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
