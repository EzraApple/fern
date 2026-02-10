"use client";

import { fetchPRStatus } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { usePRs } from "@/lib/hooks";
import type { PRStatus } from "@/lib/types";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  XCircle,
} from "lucide-react";
import { useState } from "react";

function PRStateIcon({ state }: { state: string }) {
  switch (state) {
    case "open":
      return <GitPullRequest size={16} style={{ color: "var(--success)" }} />;
    case "closed":
      return <GitPullRequest size={16} style={{ color: "var(--error)" }} />;
    case "merged":
      return <GitMerge size={16} style={{ color: "#a855f7" }} />;
    default:
      return <GitPullRequest size={16} style={{ color: "var(--text-muted)" }} />;
  }
}

function CheckBadge({ check }: { check: PRStatus["checks"][number] }) {
  const icon =
    check.conclusion === "success" ? (
      <CheckCircle size={12} style={{ color: "var(--success)" }} />
    ) : check.conclusion === "failure" ? (
      <XCircle size={12} style={{ color: "var(--error)" }} />
    ) : (
      <Clock size={12} style={{ color: "var(--warning)" }} />
    );

  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
      style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
    >
      {icon} {check.name}
    </span>
  );
}

export default function GitHubPage() {
  const [stateFilter, setStateFilter] = useState("all");
  const { data: prs, error, isLoading } = usePRs(stateFilter);
  const [expandedPR, setExpandedPR] = useState<number | null>(null);
  const [prStatuses, setPrStatuses] = useState<Record<number, PRStatus>>({});
  const [loadingPR, setLoadingPR] = useState<number | null>(null);

  const handleTogglePR = async (prNumber: number) => {
    if (expandedPR === prNumber) {
      setExpandedPR(null);
      return;
    }
    setExpandedPR(prNumber);
    if (!prStatuses[prNumber]) {
      setLoadingPR(prNumber);
      try {
        const status = await fetchPRStatus(prNumber);
        setPrStatuses((prev) => ({ ...prev, [prNumber]: status }));
      } catch {
        // silently fail
      } finally {
        setLoadingPR(null);
      }
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        GitHub Pull Requests
      </h1>

      <div className="flex gap-1 mb-4">
        {["all", "open", "closed"].map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setStateFilter(s)}
            className="px-3 py-1 rounded-md text-xs transition-colors capitalize"
            style={{
              backgroundColor: stateFilter === s ? "var(--bg-hover)" : "var(--bg-tertiary)",
              color: stateFilter === s ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading PRs...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load PRs: {error.message}</p>}

      {prs && prs.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>No pull requests found.</p>
      )}

      <div className="space-y-2">
        {prs?.map((pr) => (
          <div
            key={pr.number}
            className="rounded-lg border"
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderColor: "var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => handleTogglePR(pr.number)}
              className="w-full flex items-center gap-3 p-4 text-left"
            >
              {expandedPR === pr.number ? (
                <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
              ) : (
                <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
              )}
              <PRStateIcon state={pr.state} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  #{pr.number} {pr.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {pr.branch} by {pr.user} | {relativeTime(new Date(pr.updatedAt).getTime())}
                </p>
              </div>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1"
                style={{ color: "var(--text-muted)" }}
              >
                <ExternalLink size={14} />
              </a>
            </button>

            {expandedPR === pr.number && (
              <div className="px-4 pb-4 border-t" style={{ borderColor: "var(--border)" }}>
                {loadingPR === pr.number ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    Loading status...
                  </p>
                ) : prStatuses[pr.number] ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <p
                        className="text-xs font-medium mb-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Checks
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {prStatuses[pr.number].checks.length > 0 ? (
                          prStatuses[pr.number].checks.map((check) => (
                            <CheckBadge key={check.name} check={check} />
                          ))
                        ) : (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            No checks
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p
                        className="text-xs font-medium mb-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        Reviews
                      </p>
                      {prStatuses[pr.number].reviews.length > 0 ? (
                        <div className="space-y-1">
                          {prStatuses[pr.number].reviews.map((review) => (
                            <p
                              key={`${review.user}-${review.state}`}
                              className="text-xs"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {review.user}: {review.state}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          No reviews
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
