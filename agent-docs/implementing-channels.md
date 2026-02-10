---
name: Implementing Channels
description: |
  How to add new channel adapters to Fern.
  Reference when: adding new messaging platforms, implementing the unified interface, handling output formatting, channel prompts.
---

# Implementing Channels

## Unified Channel Interface

Every channel adapter implements the `ChannelAdapter` interface from `src/channels/types.ts`:

```typescript
interface ChannelAdapter {
  name: string;

  // Send outbound messages
  send(message: OutboundMessage): Promise<void>;

  // Channel capabilities (affects formatting)
  getCapabilities(): ChannelCapabilities;

  // Derive session ID from channel-specific identifier
  deriveSessionId(identifier: string): string;
}

interface ChannelCapabilities {
  markdown: boolean;
  streaming: boolean;
  maxMessageLength: number;
  supportsAttachments: boolean;
  supportsReply: boolean;
}
```

## Reference Implementation: WhatsApp (Twilio)

WhatsApp via Twilio is the first and currently only implemented channel. Key characteristics:

- **Webhook-based**: Twilio POSTs to `/webhooks/whatsapp` when a message arrives
- **Stateless**: No persistent connection — each request is independent
- **REST API for replies**: Responses sent via Twilio REST API, not in the webhook response
- **Empty TwiML response**: Return `<Response></Response>` to acknowledge the webhook

```typescript
// src/channels/whatsapp/adapter.ts
class WhatsAppAdapter implements ChannelAdapter {
  name = "whatsapp";

  async send(message: OutboundMessage): Promise<void> {
    const chunks = formatForChannel(message.content, this.getCapabilities());
    for (const chunk of chunks) {
      await this.gateway.sendMessage({
        to: `whatsapp:${message.channelUserId}`,
        from: this.fromNumber,
        body: chunk,
      });
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markdown: false,
      streaming: false,
      maxMessageLength: 1600, // Twilio's per-message limit
      supportsAttachments: true,
      supportsReply: false,
    };
  }

  deriveSessionId(phoneNumber: string): string {
    return `whatsapp_${phoneNumber.replace(/[^+\d]/g, "")}`;
  }
}
```

**Note on message limits**: WhatsApp natively supports 65536 characters, but Twilio's API enforces a 1600-character per-message limit. The `formatForChannel()` utility auto-chunks longer messages.

## Channel Prompts

Each channel has a "channel prompt" injected into the system context. These are stored in `config/channel-prompts.md` and injected based on the `channelName` in `AgentInput`:

```typescript
const whatsappPrompt = `
Channel: whatsapp
Tone: Warm, conversational, plain language
Formatting: Plain text only - no markdown rendering
Limits: Prefer shorter messages, emojis display well
`;
```

The `{{CHANNEL_CONTEXT}}` placeholder in `config/SYSTEM_PROMPT.md` is replaced with the channel-specific prompt at runtime.

## Output Formatting

Format output based on channel capabilities using `src/channels/format.ts`:

```typescript
function formatForChannel(content: string, capabilities: ChannelCapabilities): string[] {
  let formatted = content;

  // Strip markdown for plain text channels
  if (!capabilities.markdown) {
    formatted = stripMarkdown(formatted);
  }

  // Chunk long messages at natural break points
  if (formatted.length > capabilities.maxMessageLength) {
    return chunkMessage(formatted, capabilities.maxMessageLength);
  }

  return [formatted];
}
```

### Markdown Stripping

For channels that don't support markdown (WhatsApp):
- Bold `**text**` → `text`
- Italic `*text*` → `text`
- Code blocks → plain text
- Links `[text](url)` → `text (url)`

### Message Chunking

For channels with length limits, messages are chunked at natural break points (paragraph boundaries) to avoid splitting mid-sentence.

## Adding a New Channel

1. Create adapter directory: `src/channels/{name}/`
2. Implement `ChannelAdapter` interface in `adapter.ts`
3. Add a gateway wrapper for the channel's API in `gateway.ts`
4. Add webhook route in `src/server/webhooks.ts` (if webhook-based)
5. Register the adapter in `src/index.ts` during initialization
6. Add a channel prompt in `config/channel-prompts.md`
7. Add tests for adapter and gateway

## Anti-Patterns

### Don't: Ignore capabilities

```typescript
// Bad - sends markdown to WhatsApp
await whatsappAdapter.send({ content: "**Bold text**" });

// Good - format based on capabilities
const formatted = formatForChannel(content, adapter.getCapabilities());
await adapter.send({ content: formatted });
```

### Don't: Skip session key derivation

```typescript
// Bad - raw identifiers leak channel-specific format
const sessionKey = phoneNumber;

// Good - use adapter's deriveSessionId
const sessionKey = adapter.deriveSessionId(phoneNumber);
```
