"use client";

import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react";
import { useState } from "react";

export function ReasoningPartView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  if (!text.trim()) return null;

  return (
    <div
      className="rounded-md border"
      style={{
        backgroundColor: "var(--bg-tertiary)",
        borderColor: "var(--border)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
        )}
        <Lightbulb size={14} style={{ color: "var(--warning)" }} />
        <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>
          Thinking...
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t" style={{ borderColor: "var(--border)" }}>
          <pre
            className="mt-2 text-xs whitespace-pre-wrap"
            style={{ color: "var(--text-secondary)" }}
          >
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
