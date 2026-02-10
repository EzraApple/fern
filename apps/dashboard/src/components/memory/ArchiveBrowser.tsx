"use client";

import { fetchArchiveChunk } from "@/lib/api";
import { formatTokens, fullDateTime, relativeTime } from "@/lib/format";
import { useArchives } from "@/lib/hooks";
import type { ArchiveChunk } from "@/lib/types";
import { Archive, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";

function ChunkViewer({ chunk }: { chunk: ArchiveChunk }) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>{chunk.messageCount} messages</span>
        <span>{formatTokens(chunk.tokenCount)} tokens</span>
      </div>
      <div
        className="rounded-md p-3 text-xs"
        style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-secondary)" }}
      >
        <p className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
          Summary:
        </p>
        <p>{chunk.summary}</p>
      </div>
    </div>
  );
}

export function ArchiveBrowser() {
  const { data: summaries, error, isLoading } = useArchives();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadedChunks, setLoadedChunks] = useState<Record<string, ArchiveChunk>>({});
  const [loadingChunk, setLoadingChunk] = useState<string | null>(null);

  const handleToggle = async (summary: { id: string; threadId: string }) => {
    if (expandedId === summary.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(summary.id);

    if (!loadedChunks[summary.id]) {
      setLoadingChunk(summary.id);
      try {
        const chunk = await fetchArchiveChunk(summary.threadId, summary.id);
        setLoadedChunks((prev) => ({ ...prev, [summary.id]: chunk }));
      } catch {
        // silently fail
      } finally {
        setLoadingChunk(null);
      }
    }
  };

  if (isLoading) {
    return <p style={{ color: "var(--text-muted)" }}>Loading archives...</p>;
  }
  if (error) {
    return <p style={{ color: "var(--error)" }}>Failed to load: {error.message}</p>;
  }
  if (!summaries || summaries.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>No archives found.</p>;
  }

  return (
    <div className="space-y-2">
      {summaries.map((s) => {
        const isExpanded = expandedId === s.id;
        return (
          <div
            key={s.id}
            className="rounded-lg border"
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderColor: "var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => handleToggle(s)}
              className="w-full flex items-center gap-3 p-4 text-left"
            >
              {isExpanded ? (
                <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
              ) : (
                <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
              )}
              <Archive size={14} style={{ color: "var(--accent)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                  {s.summary.slice(0, 120)}
                  {s.summary.length > 120 ? "..." : ""}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Thread: {s.threadId} | {formatTokens(s.tokenCount)} tokens |{" "}
                  {relativeTime(s.timeEnd)}
                </p>
              </div>
            </button>
            {isExpanded && (
              <div className="px-4 pb-4" style={{ borderTop: "1px solid var(--border)" }}>
                {loadingChunk === s.id ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    Loading chunk...
                  </p>
                ) : loadedChunks[s.id] ? (
                  <ChunkViewer chunk={loadedChunks[s.id]} />
                ) : (
                  <div className="mt-3">
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      {s.summary}
                    </p>
                    <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                      <FileText size={12} className="inline mr-1" />
                      Time range: {fullDateTime(s.timeStart)} — {fullDateTime(s.timeEnd)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
