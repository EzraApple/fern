import * as fs from "node:fs";
import * as path from "node:path";
import { ulid } from "ulid";
import { loadConfig } from "../config/index.js";
import { appendJsonl, readJsonl } from "./jsonl.js";

// Event types stored in JSONL
export type SessionEvent =
	| {
			type: "user_message";
			id: string;
			timestamp: number;
			content: string;
	  }
	| {
			type: "assistant_message";
			id: string;
			timestamp: number;
			content: string;
	  }
	| {
			type: "tool_call";
			id: string;
			timestamp: number;
			callId: string;
			tool: string;
			input: unknown;
	  }
	| {
			type: "tool_result";
			id: string;
			timestamp: number;
			callId: string;
			output: string;
	  };

export interface SessionMetadata {
	id: string;
	created: number;
	updated: number;
	messageCount: number;
}

// Message format for LLM (Vercel AI SDK compatible)
export type LLMMessage =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string }
	| {
			role: "assistant";
			content: Array<{
				type: "tool-call";
				toolCallId: string;
				toolName: string;
				args: unknown;
			}>;
	  }
	| {
			role: "tool";
			content: Array<{
				type: "tool-result";
				toolCallId: string;
				result: string;
			}>;
	  };

export class Session {
	private eventsPath: string;
	private metadataPath: string;

	constructor(
		public readonly id: string,
		private readonly storagePath: string,
	) {
		this.eventsPath = path.join(storagePath, "events.jsonl");
		this.metadataPath = path.join(storagePath, "metadata.json");
	}

	static async getOrCreate(sessionId?: string): Promise<Session> {
		const config = loadConfig();
		const id = sessionId || ulid();
		const storagePath = path.join(config.storage.path, id);

		// Ensure directory exists
		await fs.promises.mkdir(storagePath, { recursive: true });

		const session = new Session(id, storagePath);

		// Initialize metadata if new session
		const metadataPath = path.join(storagePath, "metadata.json");
		try {
			await fs.promises.access(metadataPath);
		} catch {
			const metadata: SessionMetadata = {
				id,
				created: Date.now(),
				updated: Date.now(),
				messageCount: 0,
			};
			await fs.promises.writeFile(
				metadataPath,
				JSON.stringify(metadata, null, 2),
			);
		}

		return session;
	}

	private async appendEvent(event: SessionEvent): Promise<void> {
		await appendJsonl(this.eventsPath, event);
		await this.updateMetadata();
	}

	async appendUserMessage(content: string): Promise<void> {
		const event: SessionEvent = {
			type: "user_message",
			id: ulid(),
			timestamp: Date.now(),
			content,
		};
		await this.appendEvent(event);
	}

	async appendAssistantMessage(content: string): Promise<void> {
		const event: SessionEvent = {
			type: "assistant_message",
			id: ulid(),
			timestamp: Date.now(),
			content,
		};
		await this.appendEvent(event);
	}

	async appendToolCall(
		callId: string,
		tool: string,
		input: unknown,
	): Promise<void> {
		const event: SessionEvent = {
			type: "tool_call",
			id: ulid(),
			timestamp: Date.now(),
			callId,
			tool,
			input,
		};
		await this.appendEvent(event);
	}

	async appendToolResult(callId: string, output: string): Promise<void> {
		const event: SessionEvent = {
			type: "tool_result",
			id: ulid(),
			timestamp: Date.now(),
			callId,
			output,
		};
		await this.appendEvent(event);
	}

	async getEvents(): Promise<SessionEvent[]> {
		return readJsonl<SessionEvent>(this.eventsPath);
	}

	/**
	 * Convert session events to Vercel AI SDK message format
	 */
	async getMessages(): Promise<LLMMessage[]> {
		const events = await this.getEvents();
		const messages: LLMMessage[] = [];

		// Group tool calls and results together
		let pendingToolCalls: Map<
			string,
			{ toolName: string; args: unknown }
		> = new Map();

		for (const event of events) {
			switch (event.type) {
				case "user_message":
					messages.push({ role: "user", content: event.content });
					break;

				case "assistant_message":
					messages.push({ role: "assistant", content: event.content });
					break;

				case "tool_call":
					pendingToolCalls.set(event.callId, {
						toolName: event.tool,
						args: event.input,
					});
					break;

				case "tool_result": {
					const toolCall = pendingToolCalls.get(event.callId);
					if (toolCall) {
						// Add the assistant message with tool call
						messages.push({
							role: "assistant",
							content: [
								{
									type: "tool-call",
									toolCallId: event.callId,
									toolName: toolCall.toolName,
									args: toolCall.args,
								},
							],
						});
						// Add the tool result
						messages.push({
							role: "tool",
							content: [
								{
									type: "tool-result",
									toolCallId: event.callId,
									result: event.output,
								},
							],
						});
						pendingToolCalls.delete(event.callId);
					}
					break;
				}
			}
		}

		return messages;
	}

	async getMetadata(): Promise<SessionMetadata> {
		try {
			const content = await fs.promises.readFile(this.metadataPath, "utf-8");
			return JSON.parse(content);
		} catch {
			return {
				id: this.id,
				created: Date.now(),
				updated: Date.now(),
				messageCount: 0,
			};
		}
	}

	private async updateMetadata(): Promise<void> {
		const events = await this.getEvents();
		const messageCount = events.filter(
			(e) => e.type === "user_message" || e.type === "assistant_message",
		).length;

		const metadata = await this.getMetadata();
		metadata.updated = Date.now();
		metadata.messageCount = messageCount;

		await fs.promises.writeFile(
			this.metadataPath,
			JSON.stringify(metadata, null, 2),
		);
	}
}
