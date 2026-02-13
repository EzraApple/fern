"use client";

import { fullDateTime, relativeTime } from "@/lib/format";
import { useScheduledJobs } from "@/lib/hooks";
import type { ScheduledJob } from "@/lib/types";
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader,
  Repeat,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

const STATUS_FILTERS = ["all", "pending", "running", "completed", "failed", "cancelled"] as const;

function StatusBadge({ status }: { status: ScheduledJob["status"] }) {
  const colors: Record<string, { bg: string; text: string }> = {
    pending: { bg: "rgba(234,179,8,0.15)", text: "var(--warning)" },
    running: { bg: "rgba(59,130,246,0.15)", text: "var(--accent)" },
    completed: { bg: "rgba(34,197,94,0.15)", text: "var(--success)" },
    failed: { bg: "rgba(239,68,68,0.15)", text: "var(--error)" },
    cancelled: { bg: "rgba(115,115,115,0.15)", text: "var(--text-muted)" },
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

function StatusIcon({ status }: { status: ScheduledJob["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle size={14} style={{ color: "var(--success)" }} />;
    case "failed":
      return <XCircle size={14} style={{ color: "var(--error)" }} />;
    case "running":
      return <Loader size={14} className="animate-spin" style={{ color: "var(--accent)" }} />;
    case "cancelled":
      return <XCircle size={14} style={{ color: "var(--text-muted)" }} />;
    default:
      return <Clock size={14} style={{ color: "var(--warning)" }} />;
  }
}

function TypeBadge({ type }: { type: ScheduledJob["type"] }) {
  const isRecurring = type === "recurring";
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        backgroundColor: isRecurring ? "rgba(168,85,247,0.15)" : "rgba(115,115,115,0.1)",
        color: isRecurring ? "#a855f7" : "var(--text-secondary)",
      }}
    >
      {isRecurring ? <Repeat size={10} /> : <Zap size={10} />}
      {isRecurring ? "recurring" : "one-shot"}
    </span>
  );
}

function JobRow({ job }: { job: ScheduledJob }) {
  const [expanded, setExpanded] = useState(false);
  const scheduledDate = new Date(job.scheduledAt);
  const scheduledTs = scheduledDate.getTime();

  return (
    <>
      <tr
        className="border-t cursor-pointer transition-colors"
        style={{ borderColor: "var(--border)" }}
        onClick={() => setExpanded((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setExpanded((p) => !p);
        }}
        tabIndex={0}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
            ) : (
              <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
            )}
            <StatusIcon status={job.status} />
            <StatusBadge status={job.status} />
          </div>
        </td>
        <td className="px-4 py-2">
          <TypeBadge type={job.type} />
        </td>
        <td
          className="px-4 py-2 text-xs max-w-xs truncate"
          style={{ color: "var(--text-primary)" }}
          title={job.prompt}
        >
          {job.prompt.length > 80 ? `${job.prompt.slice(0, 80)}...` : job.prompt}
        </td>
        <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
          {job.cronExpr || "—"}
        </td>
        <td
          className="px-4 py-2 text-xs"
          style={{ color: "var(--text-secondary)" }}
          title={fullDateTime(scheduledTs)}
        >
          {relativeTime(scheduledTs)}
        </td>
        <td className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {job.completedAt ? relativeTime(new Date(job.completedAt).getTime()) : "—"}
        </td>
      </tr>

      {expanded && (
        <tr style={{ borderColor: "var(--border)" }}>
          <td colSpan={6} className="px-4 py-3" style={{ backgroundColor: "var(--bg-primary)" }}>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Full Prompt
                </p>
                <pre
                  className="text-xs p-3 rounded-lg overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap"
                  style={{
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {job.prompt}
                </pre>
              </div>

              {job.lastRunResponse && (
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--success)" }}>
                    Last Response
                  </p>
                  <pre
                    className="text-xs p-3 rounded-lg overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap"
                    style={{
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {job.lastRunResponse}
                  </pre>
                </div>
              )}

              {job.lastError && (
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--error)" }}>
                    Last Error
                  </p>
                  <pre
                    className="text-xs p-3 rounded-lg overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap"
                    style={{
                      backgroundColor: "rgba(239,68,68,0.1)",
                      color: "var(--error)",
                    }}
                  >
                    {job.lastError}
                  </pre>
                </div>
              )}

              <div className="flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>ID: {job.id}</span>
                <span>Created: {fullDateTime(new Date(job.createdAt).getTime())}</span>
                {job.completedAt && (
                  <span>Completed: {fullDateTime(new Date(job.completedAt).getTime())}</span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function SchedulerPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const {
    data: jobs,
    isLoading,
    error,
  } = useScheduledJobs(statusFilter === "all" ? undefined : statusFilter);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Calendar size={24} style={{ color: "#f97316" }} />
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Scheduled Jobs
        </h1>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1 rounded-md text-xs transition-colors border"
            style={{
              backgroundColor: statusFilter === s ? "var(--bg-hover)" : "transparent",
              borderColor: statusFilter === s ? "var(--border)" : "transparent",
              color: statusFilter === s ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading scheduled jobs...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load scheduled jobs.</p>}

      {jobs && jobs.length > 0 && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "var(--bg-secondary)" }}>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Status
                </th>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Type
                </th>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Prompt
                </th>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cron
                </th>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Scheduled
                </th>
                <th
                  className="text-left px-4 py-2 text-xs font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  Completed
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && jobs && jobs.length === 0 && (
        <div
          className="rounded-lg p-8 border text-center"
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          <Calendar size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
          <p style={{ color: "var(--text-muted)" }}>No scheduled jobs found.</p>
        </div>
      )}
    </div>
  );
}
