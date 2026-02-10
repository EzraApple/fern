"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TextPartView({ text }: { text: string }) {
  if (!text.trim()) return null;

  return (
    <div className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed"
      style={{ color: "var(--text-primary)" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
