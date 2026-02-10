"use client";

import { ChatView } from "@/components/session/ChatView";
import { useSession, useSessionMessages } from "@/lib/hooks";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession(id);
  const { data: messages, error, isLoading } = useSessionMessages(id, true);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href="/sessions"
          className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>
            {session?.title || id}
          </h1>
          {session?.title && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {id}
            </p>
          )}
        </div>
      </div>

      {/* Chat */}
      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading messages...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load messages.</p>}
      {messages && <ChatView messages={messages} />}
    </div>
  );
}
