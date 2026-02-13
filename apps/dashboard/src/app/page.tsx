"use client";

import { useArchives, useMemories, usePRs, useScheduledJobs, useSessions } from "@/lib/hooks";
import { Archive, ArrowRight, Brain, Calendar, GitPullRequest, MessageSquare } from "lucide-react";
import Link from "next/link";

function OverviewCard({
  href,
  label,
  count,
  icon: Icon,
  color,
}: {
  href: string;
  label: string;
  count: number | undefined;
  icon: typeof MessageSquare;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg p-5 border transition-colors group"
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <Icon size={20} style={{ color }} />
        <ArrowRight
          size={16}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--text-muted)" }}
        />
      </div>
      <p className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>
        {count !== undefined ? count : "—"}
      </p>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
    </Link>
  );
}

export default function OverviewPage() {
  const { data: sessions, error: sessionsError } = useSessions();
  const { data: memories, error: memoriesError } = useMemories();
  const { data: archives, error: archivesError } = useArchives();
  const { data: prs, error: prsError } = usePRs("all");
  const { data: jobs, error: jobsError } = useScheduledJobs();

  const errors = [
    sessionsError && `Sessions: ${sessionsError.message}`,
    memoriesError && `Memories: ${memoriesError.message}`,
    archivesError && `Archives: ${archivesError.message}`,
    prsError && `Pull Requests: ${prsError.message}`,
    jobsError && `Scheduled Jobs: ${jobsError.message}`,
  ].filter(Boolean);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        Fern Observatory
      </h1>
      <p className="mb-8" style={{ color: "var(--text-secondary)" }}>
        Agent observability dashboard
      </p>

      {errors.length > 0 && (
        <div
          className="rounded-lg p-4 mb-6 border text-sm"
          style={{
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            borderColor: "rgba(239, 68, 68, 0.3)",
            color: "var(--text-primary)",
          }}
        >
          <p className="font-semibold mb-1" style={{ color: "#ef4444" }}>
            Failed to load data
          </p>
          {errors.map((err) => (
            <p key={err} className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {err}
            </p>
          ))}
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            Run <code>curl http://localhost:4000/api/debug</code> for diagnostics
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <OverviewCard
          href="/sessions"
          label="Sessions"
          count={sessions?.length}
          icon={MessageSquare}
          color="var(--accent)"
        />
        <OverviewCard
          href="/memory"
          label="Memories"
          count={memories?.length}
          icon={Brain}
          color="var(--success)"
        />
        <OverviewCard
          href="/memory"
          label="Archives"
          count={archives?.length}
          icon={Archive}
          color="var(--warning)"
        />
        <OverviewCard
          href="/scheduler"
          label="Scheduled Jobs"
          count={jobs?.length}
          icon={Calendar}
          color="#f97316"
        />
        <OverviewCard
          href="/github"
          label="Pull Requests"
          count={prs?.length}
          icon={GitPullRequest}
          color="#a855f7"
        />
      </div>
    </div>
  );
}
