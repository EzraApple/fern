import type { ChannelCapabilities } from "@/channels/types.js";

/** Strip markdown formatting for plain-text channels */
export function stripMarkdown(content: string): string {
  return (
    content
      // Code blocks (``` ... ```) → keep inner content
      .replace(/```[\s\S]*?```/g, (match) => {
        const inner = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
        return inner;
      })
      // Inline code → keep inner content
      .replace(/`([^`]+)`/g, "$1")
      // Bold/italic → keep inner content
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Headers → keep text
      .replace(/^#{1,6}\s+/gm, "")
      // Links → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Images → (image: alt)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "(image: $1)")
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "---")
  );
}

/** Split content into chunks at natural paragraph boundaries */
export function chunkMessage(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content];

  const chunks: string[] = [];
  const paragraphs = content.split(/\n\n+/);
  let current = "";

  for (const paragraph of paragraphs) {
    // If a single paragraph exceeds max, split on sentences
    if (paragraph.length > maxLength) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) ?? [paragraph];
      for (const sentence of sentences) {
        if (current.length + sentence.length > maxLength) {
          if (current) chunks.push(current.trim());
          current = sentence;
        } else {
          current += sentence;
        }
      }
      continue;
    }

    const combined = current ? `${current}\n\n${paragraph}` : paragraph;
    if (combined.length > maxLength) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/** Format content for a specific channel's capabilities */
export function formatForChannel(content: string, capabilities: ChannelCapabilities): string[] {
  let formatted = content;

  if (!capabilities.markdown) {
    formatted = stripMarkdown(formatted);
  }

  return chunkMessage(formatted, capabilities.maxMessageLength);
}
