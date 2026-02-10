"use client";

import { relativeTime } from "@/lib/format";
import { useMemories } from "@/lib/hooks";
import { clsx } from "clsx";
import { Brain, GraduationCap, Heart, Tag } from "lucide-react";
import { useState } from "react";

const typeFilters = [
  { value: undefined, label: "All" },
  { value: "fact", label: "Facts", icon: Brain },
  { value: "preference", label: "Preferences", icon: Heart },
  { value: "learning", label: "Learnings", icon: GraduationCap },
] as const;

const typeColors: Record<string, { bg: string; text: string }> = {
  fact: { bg: "rgba(59,130,246,0.15)", text: "var(--accent)" },
  preference: { bg: "rgba(168,85,247,0.15)", text: "#a855f7" },
  learning: { bg: "rgba(34,197,94,0.15)", text: "var(--success)" },
};

export function MemoryList() {
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const { data: memories, error, isLoading } = useMemories(typeFilter);

  return (
    <div>
      {/* Type filter */}
      <div className="flex gap-1 mb-4">
        {typeFilters.map((f) => (
          <button
            type="button"
            key={f.label}
            onClick={() => setTypeFilter(f.value)}
            className={clsx("px-3 py-1 rounded-md text-xs transition-colors")}
            style={{
              backgroundColor: typeFilter === f.value ? "var(--bg-hover)" : "var(--bg-tertiary)",
              color: typeFilter === f.value ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)" }}>Loading memories...</p>}
      {error && <p style={{ color: "var(--error)" }}>Failed to load: {error.message}</p>}

      {memories && memories.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>No memories found.</p>
      )}

      <div className="space-y-2">
        {memories?.map((mem) => {
          const tc = typeColors[mem.type] || typeColors.fact;
          return (
            <div
              key={mem.id}
              className="rounded-lg p-4 border"
              style={{
                backgroundColor: "var(--bg-secondary)",
                borderColor: "var(--border)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: tc.bg, color: tc.text }}
                >
                  {mem.type}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {relativeTime(new Date(mem.createdAt).getTime())}
                </span>
              </div>
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                {mem.content}
              </p>
              {mem.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  <Tag size={12} style={{ color: "var(--text-muted)" }} />
                  {mem.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
