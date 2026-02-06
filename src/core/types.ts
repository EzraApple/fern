export interface AgentInput {
  sessionId: string;
  message: string;
  channelName?: string;
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
