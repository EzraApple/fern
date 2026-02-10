export interface AgentInput {
  sessionId: string;
  message: string;
  channelName?: string;
  /** Channel-specific user identifier (e.g., phone number for WhatsApp) */
  channelUserId?: string;
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
