import { describe, expect, it } from "vitest";
import { chunkMessage, formatForChannel, stripMarkdown } from "./format.js";
import type { ChannelCapabilities } from "./types.js";

describe("stripMarkdown", () => {
  it("removes bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
  });

  it("removes underscore bold markers", () => {
    expect(stripMarkdown("__bold text__")).toBe("bold text");
  });

  it("removes italic markers with asterisks", () => {
    expect(stripMarkdown("*italic text*")).toBe("italic text");
  });

  it("removes italic markers with underscores", () => {
    expect(stripMarkdown("_italic text_")).toBe("italic text");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdown("`some code`")).toBe("some code");
  });

  it("removes code block fences and keeps inner content", () => {
    const input = "```\nconst x = 1;\n```";
    expect(stripMarkdown(input)).toBe("const x = 1;");
  });

  it("removes code block fences with language tag", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(stripMarkdown(input)).toBe("const x = 1;");
  });

  it("removes header markers", () => {
    expect(stripMarkdown("# Heading 1")).toBe("Heading 1");
    expect(stripMarkdown("## Heading 2")).toBe("Heading 2");
    expect(stripMarkdown("### Heading 3")).toBe("Heading 3");
    expect(stripMarkdown("###### Heading 6")).toBe("Heading 6");
  });

  it("converts links to text (url) format", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe(
      "click here (https://example.com)"
    );
  });

  it("processes image syntax through link regex first since link regex precedes image regex", () => {
    // The link regex on line 22 matches [alt text](url) before the image regex on line 24
    // can match ![alt text](url), so the ! remains and the image regex never fires.
    // This documents the actual behavior of the regex ordering in stripMarkdown.
    expect(stripMarkdown("![alt text](https://example.com/img.png)")).toBe(
      "!alt text (https://example.com/img.png)"
    );
  });

  it("normalizes horizontal rules made with dashes", () => {
    expect(stripMarkdown("---")).toBe("---");
    expect(stripMarkdown("-----")).toBe("---");
  });

  it("handles multiple markdown features in one string", () => {
    const input = "# Title\n\n**Bold** and *italic* with `code`";
    const result = stripMarkdown(input);
    expect(result).toBe("Title\n\nBold and italic with code");
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkdown("no markdown here")).toBe("no markdown here");
  });

  it("handles empty string", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("handles nested bold and italic", () => {
    expect(stripMarkdown("**_bold italic_**")).toBe("bold italic");
  });
});

describe("chunkMessage", () => {
  it("returns single-element array when content fits within limit", () => {
    const result = chunkMessage("short message", 100);
    expect(result).toEqual(["short message"]);
  });

  it("splits at paragraph boundaries", () => {
    const input = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    // "Paragraph one." = 14, "Paragraph two." = 14, "Paragraph three." = 16
    // maxLength=30: "Paragraph one.\n\nParagraph two." = 30, fits. Adding third = 30+2+16=48, too big.
    const result = chunkMessage(input, 30);
    expect(result).toEqual(["Paragraph one.\n\nParagraph two.", "Paragraph three."]);
  });

  it("splits long paragraphs at sentence boundaries", () => {
    const longParagraph =
      "This is sentence one. This is sentence two. This is sentence three. This is sentence four.";
    const result = chunkMessage(longParagraph, 50);
    expect(result.length).toBe(2);
    // All sentences should be present across chunks
    const rejoined = result.join(" ");
    expect(rejoined).toContain("sentence one");
    expect(rejoined).toContain("sentence four");
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });

  it("keeps unsplittable paragraph as single chunk when no sentence boundaries exist", () => {
    // A long paragraph with no sentence-ending punctuation cannot be split further
    const input = "A".repeat(100);
    const result = chunkMessage(input, 40);
    // Falls back to [paragraph] since regex /[^.!?]+[.!?]+\s*/g returns null
    expect(result).toEqual(["A".repeat(100)]);
  });

  it("handles exact boundary length", () => {
    const input = "exact";
    const result = chunkMessage(input, 5);
    expect(result).toEqual(["exact"]);
  });

  it("returns content as-is when under max length", () => {
    const result = chunkMessage("", 100);
    expect(result).toEqual([""]);
  });

  it("trims whitespace from chunks", () => {
    const input = "First paragraph.\n\nSecond paragraph.";
    const result = chunkMessage(input, 20);
    expect(result).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("combines short paragraphs when they fit within limit", () => {
    const input = "A.\n\nB.\n\nC.";
    const result = chunkMessage(input, 100);
    expect(result).toEqual(["A.\n\nB.\n\nC."]);
  });

  it("returns content unchanged when total length is within limit, even with extra newlines", () => {
    // "First.\n\n\n\nSecond." is 21 chars, which is < 100
    // The early return on line 32 fires before any splitting occurs
    const input = "First.\n\n\n\nSecond.";
    const result = chunkMessage(input, 100);
    expect(result).toEqual(["First.\n\n\n\nSecond."]);
  });

  it("collapses extra paragraph breaks to double-newline when forced to split and recombine", () => {
    // Force splitting by making maxLength smaller than the full string
    // "First.\n\n\n\nSecond." = 21 chars, set maxLength to 10
    // split(/\n\n+/) gives ["First.", "Second."], each paragraph < 10... actually 7 chars each
    // "First." = 6 chars, "Second." = 7 chars, combined = 6+2+7 = 15 > 10, so they split
    const input = "First.\n\n\n\nSecond.";
    const result = chunkMessage(input, 10);
    expect(result).toEqual(["First.", "Second."]);
  });
});

describe("formatForChannel", () => {
  const markdownCapabilities: ChannelCapabilities = {
    markdown: true,
    streaming: false,
    maxMessageLength: 4096,
    supportsAttachments: false,
    supportsReply: false,
  };

  const plainTextCapabilities: ChannelCapabilities = {
    markdown: false,
    streaming: false,
    maxMessageLength: 1600,
    supportsAttachments: false,
    supportsReply: false,
  };

  it("preserves markdown when channel supports it", () => {
    const result = formatForChannel("**bold** text", markdownCapabilities);
    expect(result).toEqual(["**bold** text"]);
  });

  it("strips markdown when channel does not support it", () => {
    const result = formatForChannel("**bold** text", plainTextCapabilities);
    expect(result).toEqual(["bold text"]);
  });

  it("chunks long messages based on channel maxMessageLength", () => {
    // Create content with paragraph breaks that exceeds 4096 chars
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${"x".repeat(300)}.`);
    const longMessage = paragraphs.join("\n\n");
    const result = formatForChannel(longMessage, markdownCapabilities);
    expect(result.length).toBeGreaterThan(1);
    // Verify no chunk exceeds the limit
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
    // Verify all content is preserved (every paragraph appears in some chunk)
    const allContent = result.join("\n\n");
    for (let i = 0; i < 20; i++) {
      expect(allContent).toContain(`Paragraph ${i}`);
    }
  });

  it("returns single chunk for short messages", () => {
    const result = formatForChannel("Hello", plainTextCapabilities);
    expect(result).toEqual(["Hello"]);
  });

  it("strips markdown and chunks when both apply", () => {
    const caps: ChannelCapabilities = {
      markdown: false,
      streaming: false,
      maxMessageLength: 20,
      supportsAttachments: false,
      supportsReply: false,
    };
    const input = "**Bold paragraph.**\n\n*Italic paragraph.*";
    const result = formatForChannel(input, caps);
    // After stripping: "Bold paragraph.\n\nItalic paragraph."
    // "Bold paragraph." = 15 chars, "Italic paragraph." = 17 chars
    // Combined = 15 + 2 + 17 = 34 chars > 20, so they split
    expect(result).toEqual(["Bold paragraph.", "Italic paragraph."]);
  });
});
