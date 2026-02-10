"use client";

import Link from "next/link";
import type { Session } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { MessageSquare } from "lucide-react";

export function SessionList({ sessions }: { sessions: Session[] }) {
  const sorted = [...sessions].sort(
    (a, b) => b.time.updated - a.time.updated
  );

  if (sorted.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)" }}>No sessions found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {sorted.map((session) => (
        <Link
          key={session.id}
          href={`/sessions/${session.id}`}
          className="block rounded-lg p-4 transition-colors border"
          style={{
            backgroundColor: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <MessageSquare
                size={16}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
              />
              <div className="min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {session.title || session.id}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {session.id.slice(0, 8)}
                </p>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {relativeTime(session.time.updated)}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Created {relativeTime(session.time.created)}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
