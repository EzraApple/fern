"use client";

import { fullDateTime, relativeTime } from "@/lib/format";
import type { AssistantMessage, Part, SessionMessage } from "@/lib/types";
import { Bot, User } from "lucide-react";
import { ReasoningPartView } from "./ReasoningPart";
import { TextPartView } from "./TextPart";
import { TokenSummary } from "./TokenSummary";
import { ToolCallPart } from "./ToolCallPart";

function PartRenderer({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <TextPartView text={part.text} />;
    case "tool":
      return <ToolCallPart part={part} />;
    case "reasoning":
      return <ReasoningPartView text={part.text} />;
    case "step-finish":
      return (
        <div
          className="text-xs py-1 px-2 rounded mt-1"
          style={{ backgroundColor: "var(--bg-tertiary)", color: "var(--text-muted)" }}
        >
          Step complete: {part.tokens.input + part.tokens.output} tokens
        </div>
      );
    default:
      return null;
  }
}

export function MessageBubble({ message }: { message: SessionMessage }) {
  const { info, parts } = message;
  const isUser = info.role === "user";
  const isAssistant = info.role === "assistant";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-lg px-4 py-3"
        style={{
          backgroundColor: isUser ? "var(--user-bubble)" : "var(--assistant-bubble)",
          border: isUser ? "none" : "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          {isUser ? (
            <User size={14} style={{ color: "var(--accent)" }} />
          ) : (
            <Bot size={14} style={{ color: "var(--success)" }} />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: isUser ? "var(--accent)" : "var(--success)" }}
          >
            {isUser ? "User" : "Assistant"}
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
            title={fullDateTime(info.time.created)}
          >
            {relativeTime(info.time.created)}
          </span>
          {isAssistant && (info as AssistantMessage).tokens && (
            <TokenSummary
              tokens={(info as AssistantMessage).tokens}
              cost={(info as AssistantMessage).cost}
            />
          )}
        </div>

        {/* Parts */}
        <div className="space-y-2">
          {parts.map((part) => (
            <PartRenderer key={part.id} part={part} />
          ))}
        </div>
      </div>
    </div>
  );
}
