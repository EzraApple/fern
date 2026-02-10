"use client";

import { useSessions, useMemories, useArchives, usePRs } from "@/lib/hooks";
import Link from "next/link";
import {
  MessageSquare,
  Brain,
  Archive,
  GitPullRequest,
  ArrowRight,
} from "lucide-react";

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
  const { data: sessions } = useSessions();
  const { data: memories } = useMemories();
  const { data: archives } = useArchives();
  const { data: prs } = usePRs("all");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        Fern Observatory
      </h1>
      <p className="mb-8" style={{ color: "var(--text-secondary)" }}>
        Agent observability dashboard
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
