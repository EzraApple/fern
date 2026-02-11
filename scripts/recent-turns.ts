/**
 * Show recent conversation turns from OpenCode session storage.
 * Usage: npx tsx scripts/recent-turns.ts [count]
 *
 * Finds the most recent session and prints the last N user/assistant turns
 * with tool calls summarized inline.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const STORAGE_BASE = path.join(os.homedir(), ".local/share/opencode/storage");
const MAX_TURNS = Number.parseInt(process.argv[2] || "10", 10);

interface SessionFile {
  id: string;
  title: string;
  time: { created: number; updated: number };
}

interface MessageFile {
  id: string;
  role: string;
  time: { created: number };
}

interface PartFile {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: unknown; output?: string };
}

function findRecentSessions(limit: number): SessionFile[] {
  const projectDirs = fs.readdirSync(path.join(STORAGE_BASE, "session"));
  const sessions: (SessionFile & { file: string })[] = [];

  for (const dir of projectDirs) {
    const sessionDir = path.join(STORAGE_BASE, "session", dir);
    if (!fs.statSync(sessionDir).isDirectory()) continue;

    for (const file of fs.readdirSync(sessionDir)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(
        fs.readFileSync(path.join(sessionDir, file), "utf-8")
      ) as SessionFile;
      sessions.push({ ...data, file });
    }
  }

  return sessions
    .sort((a, b) => b.time.updated - a.time.updated)
    .slice(0, limit);
}

function getMessages(sessionId: string): MessageFile[] {
  const msgDir = path.join(STORAGE_BASE, "message", sessionId);
  if (!fs.existsSync(msgDir)) return [];

  return fs
    .readdirSync(msgDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(msgDir, f), "utf-8")) as MessageFile)
    .sort((a, b) => a.time.created - b.time.created);
}

function getParts(messageId: string): PartFile[] {
  const partDir = path.join(STORAGE_BASE, "part", messageId);
  if (!fs.existsSync(partDir)) return [];

  return fs
    .readdirSync(partDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(partDir, f), "utf-8")) as PartFile);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// --- Main ---

const sessions = findRecentSessions(1);
if (sessions.length === 0) {
  console.log("No sessions found.");
  process.exit(0);
}

const session = sessions[0]!;
console.log(`\x1b[1mSession:\x1b[0m ${session.title}`);
console.log(
  `\x1b[2m${formatTime(session.time.created)} - ${formatTime(session.time.updated)}\x1b[0m`
);
console.log("");

const messages = getMessages(session.id);
const recent = messages.slice(-MAX_TURNS);

for (const msg of recent) {
  const parts = getParts(msg.id);
  const role = msg.role === "user" ? "\x1b[36muser\x1b[0m" : "\x1b[33massistant\x1b[0m";
  const time = `\x1b[2m${formatTime(msg.time.created)}\x1b[0m`;

  console.log(`${time} ${role}`);

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      console.log(`  ${truncate(part.text, 200)}`);
    } else if (part.type === "tool" && part.tool) {
      const status = part.state?.status ?? "?";
      const icon = status === "completed" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      const output = part.state?.output ? truncate(part.state.output, 100) : "";
      console.log(`  ${icon} \x1b[2m${part.tool}\x1b[0m ${output}`);
    }
  }
  console.log("");
}
