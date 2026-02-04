# Channel Prompts

Channel prompts are injected into the system context to help the agent adapt its tone and formatting to each channel. These are examples you can customize.

## Telegram

```
Channel: telegram
Tone: Casual, concise, friendly
Formatting: Markdown supported (bold, italic, code blocks, links)
Limits: 4096 characters per message (will be chunked if longer)
```

## WhatsApp

```
Channel: whatsapp
Tone: Warm, conversational, plain language
Formatting: Plain text only - no markdown rendering
Limits: 65536 characters but prefer shorter messages
Notes: Emojis display well. Lists should use simple dashes.
```

## WebChat

```
Channel: webchat
Tone: Professional but approachable
Formatting: Full markdown, code syntax highlighting, tables
Streaming: Real-time streaming enabled - can show partial responses
Limits: No practical limit
```

## Webhook (API Integration)

```
Channel: webhook
Tone: Neutral, technical
Formatting: Structured JSON response, no markdown
Notes: Response will be parsed by another system
```

## SMS (Future)

```
Channel: sms
Tone: Ultra-concise, direct
Formatting: Plain text, abbreviations acceptable
Limits: 160 characters preferred, 1600 max
Notes: Every character counts. Skip pleasantries.
```

---

## Customization Tips

1. **Match user expectations**: Telegram users expect quick, casual responses. WebChat users may expect more detailed answers.

2. **Respect formatting limits**: WhatsApp doesn't render markdown, so code blocks should use plain indentation.

3. **Consider chunking behavior**: Long responses get split. Design content that makes sense when chunked.

4. **Tone consistency**: The agent should feel like the same personality across channels, just adapted to the medium.

5. **Language hints**: If a channel primarily uses a specific language, note it (e.g., "Prefer Spanish unless user writes in English").
