export interface AgentInput {
	sessionId: string | undefined;
	message: string;
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
