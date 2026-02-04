import type { z } from "zod";

export interface ToolResult {
	title: string;
	output: string;
	metadata?: Record<string, unknown>;
}

export interface ToolDefinition<TParams extends z.ZodType = z.ZodType> {
	id: string;
	description: string;
	parameters: TParams;
	execute: (args: z.infer<TParams>) => Promise<ToolResult>;
}

export function defineTool<TParams extends z.ZodType>(
	definition: ToolDefinition<TParams>,
): ToolDefinition<TParams> {
	return definition;
}
