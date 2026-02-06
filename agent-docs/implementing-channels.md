---
name: Implementing Channels
description: |
  How to add new channel adapters to Fern.
  Reference when: adding new messaging platforms, implementing the unified interface, handling output formatting, channel prompts.
---

# Implementing Channels

## Unified Channel Interface

Every channel adapter implements this interface:

```typescript
interface ChannelAdapter {
  name: string;

  // Initialize the adapter (connect, authenticate)
  init(): Promise<void>;

  // Handle incoming messages
  receive(handler: (message: InboundMessage) => void): void;

  // Send outbound messages
  send(message: OutboundMessage): Promise<void>;

  // Channel capabilities
  getCapabilities(): ChannelCapabilities;
}

interface InboundMessage {
  channelId: string;
  userId: string;
  content: string;
  attachments?: Attachment[];
  replyToId?: string;
}

interface OutboundMessage {
  channelId: string;
  userId: string;
  content: string;
  attachments?: Attachment[];
  replyToId?: string;
}

interface ChannelCapabilities {
  markdown: boolean;
  streaming: boolean;
  maxMessageLength: number;
  supportsAttachments: boolean;
  supportsReply: boolean;
}
```

## Channel Capabilities

Different channels have different capabilities:

| Channel | Markdown | Streaming | Max Length | Attachments |
|---------|----------|-----------|------------|-------------|
| Telegram | Yes | No | 4096 | Yes |
| WhatsApp (Twilio) | No | No | 1600 (Twilio limit) | Yes |
| WebChat | Yes | Yes | Unlimited | Yes |
| Webhook | N/A | No | N/A | Yes |

## Channel Prompts

Each channel has a "channel prompt" injected into system context:

```typescript
const telegramPrompt = `
Channel: telegram
Tone: Casual, concise, friendly
Formatting: Markdown supported (bold, italic, code blocks, links)
Limits: 4096 characters per message
`;

const whatsappPrompt = `
Channel: whatsapp
Tone: Warm, conversational, plain language
Formatting: Plain text only - no markdown rendering
Limits: Prefer shorter messages, emojis display well
`;
```

Store these in `config/channel-prompts.md` and inject based on channel.

## Output Formatting

Format output based on channel capabilities:

```typescript
function formatOutput(content: string, channel: ChannelAdapter): string {
  const caps = channel.getCapabilities();

  if (!caps.markdown) {
    // Strip markdown for plain text channels
    return stripMarkdown(content);
  }

  if (content.length > caps.maxMessageLength) {
    // Chunk long messages
    return chunkMessage(content, caps.maxMessageLength);
  }

  return content;
}
```

## Message Chunking

For channels with length limits, chunk messages at natural break points:

```typescript
function chunkMessage(content: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const paragraphs = content.split("\n\n");

  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxLength) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}
```

## Example: Telegram Adapter

```typescript
import { Telegraf } from "telegraf";

class TelegramAdapter implements ChannelAdapter {
  name = "telegram";
  private bot: Telegraf;

  constructor(private token: string) {
    this.bot = new Telegraf(token);
  }

  async init(): Promise<void> {
    await this.bot.launch();
  }

  receive(handler: (message: InboundMessage) => void): void {
    this.bot.on("message", (ctx) => {
      if (ctx.message && "text" in ctx.message) {
        handler({
          channelId: `telegram_${ctx.chat.id}`,
          userId: String(ctx.from.id),
          content: ctx.message.text,
          replyToId: ctx.message.reply_to_message?.message_id?.toString(),
        });
      }
    });
  }

  async send(message: OutboundMessage): Promise<void> {
    const chatId = message.channelId.replace("telegram_", "");
    const chunks = chunkMessage(message.content, 4096);

    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(chatId, chunk, {
        parse_mode: "Markdown",
        reply_to_message_id: message.replyToId
          ? parseInt(message.replyToId)
          : undefined,
      });
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      markdown: true,
      streaming: false,
      maxMessageLength: 4096,
      supportsAttachments: true,
      supportsReply: true,
    };
  }
}
```

## Example: WebChat Adapter (with Streaming)

```typescript
class WebChatAdapter implements ChannelAdapter {
  name = "webchat";
  private connections: Map<string, WebSocket> = new Map();

  getCapabilities(): ChannelCapabilities {
    return {
      markdown: true,
      streaming: true,
      maxMessageLength: Infinity,
      supportsAttachments: true,
      supportsReply: true,
    };
  }

  async sendStreaming(
    message: OutboundMessage,
    stream: AsyncIterable<string>
  ): Promise<void> {
    const ws = this.connections.get(message.channelId);
    if (!ws) return;

    for await (const chunk of stream) {
      ws.send(JSON.stringify({ type: "chunk", content: chunk }));
    }
    ws.send(JSON.stringify({ type: "done" }));
  }
}
```

## Example: WhatsApp Adapter (Twilio, Webhook-Based)

This is the first implemented channel. Key differences from polling-based adapters (like Telegram):

- **Webhook-based**: Twilio POSTs to `/webhooks/whatsapp` when a message arrives
- **Stateless**: No persistent connection — each request is independent
- **REST API for replies**: We send responses via Twilio REST API, not in the webhook response
- **Empty TwiML response**: Return `<Response></Response>` to acknowledge the webhook without sending a duplicate

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

**Twilio webhook signature validation**: Use `twilio.validateRequest()` to verify incoming webhooks are genuinely from Twilio. Currently optional but recommended for production.

**Note on message limits**: WhatsApp natively supports 65536 characters, but Twilio's API enforces a 1600-character per-message limit. The `formatForChannel()` utility auto-chunks longer messages.

## Registering Channels

Add channels to the channel registry:

```typescript
// src/channels/index.ts
import { TelegramAdapter } from "./telegram";
import { WhatsAppAdapter } from "./whatsapp";
import { WebChatAdapter } from "./webchat";

export function createChannels(config: Config) {
  const channels: ChannelAdapter[] = [];

  if (config.channels.telegram?.enabled) {
    channels.push(new TelegramAdapter(config.channels.telegram.token));
  }

  if (config.channels.whatsapp?.enabled) {
    channels.push(new WhatsAppAdapter(config.channels.whatsapp));
  }

  // ...

  return channels;
}
```

## Channel Queue

Each channel+user combination maps to a session. Messages queue per-session:

```typescript
// Only one agent run per session at a time
// Additional messages queue until current run completes
const sessionQueue = new Map<string, InboundMessage[]>();

function handleInbound(message: InboundMessage) {
  const sessionKey = `${message.channelId}_${message.userId}`;

  if (isSessionRunning(sessionKey)) {
    // Queue for later
    sessionQueue.get(sessionKey)?.push(message);
  } else {
    // Process immediately
    processMessage(message);
  }
}
```

## Anti-Patterns

### Don't: Ignore capabilities

```typescript
// Bad - sends markdown to WhatsApp
await whatsappAdapter.send({ content: "**Bold text**" });

// Good - format based on capabilities
const formatted = formatOutput(content, whatsappAdapter);
await whatsappAdapter.send({ content: formatted });
```

### Don't: Block on streaming channels

```typescript
// Bad - blocks until full response ready
const fullResponse = await getFullResponse();
await webChatAdapter.send({ content: fullResponse });

// Good - stream chunks as available
await webChatAdapter.sendStreaming(message, responseStream);
```
