export interface ImageAttachment {
  url: string;
  mimeType: string;
}

export interface AgentInput {
  sessionId: string;
  message: string;
  channelName?: string;
  /** Channel-specific user identifier (e.g., phone number for WhatsApp) */
  channelUserId?: string;
  /** OpenCode agent to use (defaults to "fern") */
  agentType?: string;
  /** Image attachments to include with the message */
  images?: ImageAttachment[];
}

export interface ToolCallRecord {
  tool: string;
  input: unknown;
  output: string;
}

export interface AgentResult {
  sessionId: string;
  response: string;
  toolCalls: ToolCallRecord[] | undefined;
}
