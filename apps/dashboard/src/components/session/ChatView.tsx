"use client";

import type { SessionMessage } from "@/lib/types";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

export function ChatView({ messages }: { messages: SessionMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  if (messages.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>No messages in this session.</p>;
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto space-y-4 pr-2">
      {messages.map((msg, i) => (
        <MessageBubble key={msg.info.id || i} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
