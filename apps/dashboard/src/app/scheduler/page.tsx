"use client";

import { relativeTime } from "@/lib/format";
import { useScheduledJobs } from "@/lib/hooks";
import type { JobStatus, ScheduledJob } from "@/lib/types";
import { AlertCircle, Calendar, CheckCircle, Clock, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";

const statusConfig: Record<
  JobStatus,
  { label: string; icon: typeof Clock; color: string; bgColor: string }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    color: "var(--warning)",
    bgColor: "rgba(234, 179, 8, 0.1)",
  },
  running: {
    label: "Running",
    icon: RefreshCw,
    color: "var(--info)",
    bgColor: "rgba(59, 130, 246, 0.1)",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    color: "var(--success)",
    bgColor: "rgba(34, 197, 94, 0.1)",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    color: "var(--error)",
    bgColor: "rgba(239, 68, 68, 0.1)",
  },
  cancelled: {
    label: "Cancelled",
    icon: AlertCircle,
    color: "var(--text-muted)",
    bgColor: "var(--bg-tertiary)",
  },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium"
      style={{
        backgroundColor: config.bgColor,
        color: config.color,
      }}
    >
      <Icon size={12} />
      {config.label}
    </span>
  );
}

function TypeBadge({ type, cronExpr }: { type: string; cronExpr?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
      style={{
        backgroundColor: "var(--bg-tertiary)",
        color: "var(--text-secondary)",
      }}
    >
      <Calendar size={12} />
      {type === "recurring" ? <span title={cronExpr}>Recurring</span> : "One-shot"}
    </span>
  );
}

function JobCard({ job }: { job: ScheduledJob }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border"
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <button type="button" onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={job.status} />
              <TypeBadge type={job.type} cronExpr={job.cronExpr} />
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                {job.id}
              </span>
            </div>
            <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
              {job.prompt}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Scheduled: {new Date(job.scheduledAt).toLocaleString()}
              {job.status === "pending" && (
                <span className="ml-2">({relativeTime(new Date(job.scheduledAt).getTime())})</span>
              )}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                Prompt
              </p>
              <p
                className="text-sm whitespace-pre-wrap"
                style={{
                  color: "var(--text-secondary)",
                  backgroundColor: "var(--bg-tertiary)",
                  padding: "0.75rem",
                  borderRadius: "0.375rem",
                }}
              >
                {job.prompt}
              </p>
            </div>

            {job.cronExpr && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Cron Expression
                </p>
                <code
                  className="text-sm px-2 py-1 rounded"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-tertiary)",
                  }}
                >
                  {job.cronExpr}
                </code>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Created
                </p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Updated
                </p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {new Date(job.updatedAt).toLocaleString()}
                </p>
              </div>
            </div>

            {job.completedAt && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Completed
                </p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {new Date(job.completedAt).toLocaleString()}
                </p>
              </div>
            )}

            {job.lastRunResponse && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Last Response
                </p>
                <p
                  className="text-sm whitespace-pre-wrap"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-tertiary)",
                    padding: "0.75rem",
                    borderRadius: "0.375rem",
                  }}
                >
                  {job.lastRunResponse.slice(0, 500)}
                  {job.lastRunResponse.length > 500 && "..."}
                </p>
              </div>
            )}

            {job.lastError && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--error)" }}>
                  Error
                </p>
                <p
                  className="text-sm whitespace-pre-wrap"
                  style={{
                    color: "var(--error)",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    padding: "0.75rem",
                    borderRadius: "0.375rem",
                  }}
                >
                  {job.lastError}
                </p>
              </div>
            )}

            {Object.keys(job.metadata).length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
                  Metadata
                </p>
                <pre
                  className="text-xs p-2 rounded overflow-x-auto"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-tertiary)",
                  }}
                >
                  {JSON.stringify(job.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SchedulerPage() {
  const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>(undefined);
  const { data: jobs, error, isLoading } = useScheduledJobs(statusFilter);

  const statusCounts = {
    pending: jobs?.filter((j) => j.status === "pending").length ?? 0,
    running: jobs?.filter((j) => j.status === "running").length ?? 0,
    completed: jobs?.filter((j) => j.status === "completed").length ?? 0,
    failed: jobs?.filter((j) => j.status === "failed").length ?? 0,
    cancelled: jobs?.filter((j) => j.status === "cancelled").length ?? 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        Scheduled Jobs
      </h1>
      <p className="mb-6" style={{ color: "var(--text-muted)" }}>
        View and manage Fern&apos;s scheduled tasks and recurring jobs.
      </p>

      {/* Status summary */}
      <div
        className="grid grid-cols-5 gap-2 mb-6 p-3 rounded-lg"
        style={{ backgroundColor: "var(--bg-secondary)" }}
      >
        {(Object.keys(statusCounts) as JobStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? undefined : status)}
            className="flex flex-col items-center p-2 rounded transition-colors"
            style={{
              backgroundColor: statusFilter === status ? "var(--bg-hover)" : "transparent",
            }}
          >
            <span className="text-lg font-bold" style={{ color: statusConfig[status].color }}>
              {statusCounts[status]}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {statusConfig[status].label}
            </span>
          </button>
        ))}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-1 mb-4">
        <button
          type="button"
          onClick={() => setStatusFilter(undefined)}
          className="px-3 py-1 rounded-md text-xs transition-colors"
          style={{
            backgroundColor: statusFilter === undefined ? "var(--bg-hover)" : "var(--bg-tertiary)",
            color: statusFilter === undefined ? "var(--text-primary)" : "var(--text-secondary)",
          }}
        >
          All
        </button>
        {(["pending", "running", "completed", "failed", "cancelled"] as JobStatus[]).map(
          (status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className="px-3 py-1 rounded-md text-xs transition-colors capitalize"
              style={{
                backgroundColor: statusFilter === status ? "var(--bg-hover)" : "var(--bg-tertiary)",
                color: statusFilter === status ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              {status}
            </button>
          )
        )}
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading jobs...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load jobs: {error.message}</p>}

      {jobs && jobs.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>
          {statusFilter ? `No ${statusFilter} jobs found.` : "No scheduled jobs found."}
        </p>
      )}

      <div className="space-y-2">
        {jobs?.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
