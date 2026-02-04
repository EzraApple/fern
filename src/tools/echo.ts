import { z } from "zod";
import { defineTool } from "./tool.js";

export const echoTool = defineTool({
	id: "echo",
	description:
		"Echoes back the input text exactly as provided. Use this to test tool execution or repeat information back to the user.",
	parameters: z.object({
		text: z.string().describe("The text to echo back"),
	}),
	async execute({ text }) {
		return {
			title: "Echo",
			output: text,
		};
	},
});
