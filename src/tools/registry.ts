import { tool } from "ai";
import { z } from "zod";

/**
 * Get tools in Vercel AI SDK format
 * Each tool is defined inline to avoid type conversion issues
 */
export function getAITools() {
	return {
		echo: tool({
			description:
				"Echoes back the input text exactly as provided. Use this to test tool execution or repeat information back to the user.",
			parameters: z.object({
				text: z.string().describe("The text to echo back"),
			}),
			execute: async ({ text }) => text,
		}),
		time: tool({
			description:
				"Returns the current date and time. Use this when the user asks about the current time, date, or needs a timestamp.",
			parameters: z.object({}),
			execute: async () => new Date().toISOString(),
		}),
	};
}

/**
 * Execute a tool by ID (for manual execution if needed)
 */
export async function executeTool(
	toolId: string,
	args: Record<string, unknown>,
): Promise<string> {
	const tools = getAITools();
	const toolFn = tools[toolId as keyof typeof tools];

	if (!toolFn) {
		throw new Error(`Unknown tool: ${toolId}`);
	}

	// The tool function from AI SDK has execute
	// biome-ignore lint/suspicious/noExplicitAny: Dynamic tool execution
	const result = await (toolFn as any).execute(args);
	return String(result);
}

/**
 * Get list of available tool IDs
 */
export function getToolIds(): string[] {
	return Object.keys(getAITools());
}
