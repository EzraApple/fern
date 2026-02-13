"use client";

import type { SessionMessage } from "@/lib/types";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";

const BOTTOM_THRESHOLD = 100; // px from bottom to count as "at bottom"

export function ChatView({ messages }: { messages: SessionMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const prevCountRef = useRef(messages.length);

  const checkIfAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setShowJumpButton(false);
    }
  }, [checkIfAtBottom]);

  const jumpToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    isAtBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  useEffect(() => {
    const newMessages = messages.length > prevCountRef.current;
    prevCountRef.current = messages.length;

    if (!newMessages) return;

    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowJumpButton(true);
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>No messages in this session.</p>;
  }

  return (
    <div className="relative flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto space-y-4 pr-2"
      >
        {messages.map((msg, i) => (
          <MessageBubble key={msg.info.id || i} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {showJumpButton && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:brightness-110"
          style={{
            backgroundColor: "var(--bg-tertiary)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <ArrowDown size={12} />
          New messages
        </button>
      )}
    </div>
  );
}
