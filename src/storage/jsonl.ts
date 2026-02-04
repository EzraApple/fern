import * as fs from "node:fs";
import * as readline from "node:readline";

/**
 * Append a JSON object as a line to a JSONL file
 */
export async function appendJsonl<T>(filePath: string, data: T): Promise<void> {
	const line = JSON.stringify(data) + "\n";
	await fs.promises.appendFile(filePath, line, "utf-8");
}

/**
 * Read all lines from a JSONL file
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		return lines.map((line) => JSON.parse(line) as T);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

/**
 * Stream lines from a JSONL file (for large files)
 */
export async function* streamJsonl<T>(
	filePath: string,
): AsyncGenerator<T, void, unknown> {
	try {
		const fileStream = fs.createReadStream(filePath);
		const rl = readline.createInterface({
			input: fileStream,
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		for await (const line of rl) {
			if (line.trim()) {
				yield JSON.parse(line) as T;
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return;
		}
		throw error;
	}
}
