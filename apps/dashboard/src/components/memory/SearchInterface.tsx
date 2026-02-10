"use client";

import { useState } from "react";
import { searchMemories } from "@/lib/api";
import type { UnifiedSearchResult } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { Search, Archive, Brain } from "lucide-react";

export function SearchInterface() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnifiedSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const data = await searchMemories(query.trim());
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Search form */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories (same hybrid vector+FTS5 as the agent)..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border text-sm outline-none"
            style={{
              backgroundColor: "var(--bg-secondary)",
              borderColor: "var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: "var(--accent)",
            color: "#fff",
          }}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {/* Error */}
      {error && (
        <p className="mb-4" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          <div className="space-y-2">
            {results.map((result) => (
              <div
                key={result.id}
                className="rounded-lg p-4 border"
                style={{
                  backgroundColor: "var(--bg-secondary)",
                  borderColor: "var(--border)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  {result.source === "archive" ? (
                    <Archive size={14} style={{ color: "var(--accent)" }} />
                  ) : (
                    <Brain size={14} style={{ color: "var(--success)" }} />
                  )}
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        result.source === "archive"
                          ? "rgba(59,130,246,0.15)"
                          : "rgba(34,197,94,0.15)",
                      color:
                        result.source === "archive"
                          ? "var(--accent)"
                          : "var(--success)",
                    }}
                  >
                    {result.source}
                  </span>
                  {result.memoryType && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {result.memoryType}
                    </span>
                  )}
                  {/* Relevance score bar */}
                  <div className="ml-auto flex items-center gap-2">
                    <div
                      className="w-16 h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: "var(--bg-tertiary)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round(result.relevanceScore * 100)}%`,
                          backgroundColor: "var(--accent)",
                        }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {(result.relevanceScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {result.text}
                </p>
                {result.timeRange && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {relativeTime(result.timeRange.start)} — {relativeTime(result.timeRange.end)}
                  </p>
                )}
                {result.tags && result.tags.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    {result.tags.map((tag) => (
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
            ))}
          </div>
        </div>
      )}

      {results !== null && results.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>No results found.</p>
      )}
    </div>
  );
}
