"use client";

import { SessionList } from "@/components/session/SessionList";
import { useSessions } from "@/lib/hooks";

export default function SessionsPage() {
  const { data: sessions, error, isLoading } = useSessions();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        Sessions
      </h1>

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading sessions...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load sessions.</p>}
      {sessions && <SessionList sessions={sessions} />}
    </div>
  );
}
