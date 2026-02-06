export interface InboundMessage {
  channelName: string;
  channelUserId: string;
  content: string;
  attachments?: Attachment[];
  replyToId?: string;
  raw?: unknown;
}

export interface OutboundMessage {
  channelName: string;
  channelUserId: string;
  content: string;
  attachments?: Attachment[];
  replyToId?: string;
}

export interface Attachment {
  type: "image" | "document" | "audio" | "video";
  url: string;
  mimeType?: string;
  filename?: string;
}

export interface ChannelCapabilities {
  markdown: boolean;
  streaming: boolean;
  maxMessageLength: number;
  supportsAttachments: boolean;
  supportsReply: boolean;
}

export interface ChannelAdapter {
  readonly name: string;
  init(): Promise<void>;
  shutdown(): Promise<void>;
  send(message: OutboundMessage): Promise<void>;
  getCapabilities(): ChannelCapabilities;
}
