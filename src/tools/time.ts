import { z } from "zod";
import { defineTool } from "./tool.js";

export const timeTool = defineTool({
	id: "time",
	description:
		"Returns the current date and time. Use this when the user asks about the current time, date, or needs a timestamp.",
	parameters: z.object({}),
	async execute() {
		const now = new Date();
		return {
			title: "Current Time",
			output: now.toISOString(),
			metadata: {
				timestamp: now.getTime(),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			},
		};
	},
});
