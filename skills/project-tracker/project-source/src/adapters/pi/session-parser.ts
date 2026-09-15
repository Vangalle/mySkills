/**
 * Pi session parser (sections 3.2 / 3.3).
 *
 * Pi JSONL formats handled:
 *   legacy header: { type:"session_header", version, id, cwd, startedAt }
 *   current header: { type:"session", version, id, cwd, timestamp }
 *   legacy message: { type:"message", id, parentId?, role, text, stopReason?, ts }
 *   current message: { type:"message", id, parentId?, timestamp, message:{ role, content, stopReason? } }
 *     { type:"tool_call", id, parentId?, tool, input, ts }
 *     { type:"tool_result", id, parentId?, output, ts }
 *     { type:"compaction", id, parentId?, summary,
 *       retainedTail?: string[] | firstKeptEntryId?: string, ts }
 *
 * Sessions are ALWAYS opened read-only; an incomplete final line (session
 * being written right now) is ignored with a warning, never an error.
 */
import { readFile } from "node:fs/promises";
import type { PiSessionEvidence } from "../../contracts.js";
import type { CollectionReporter } from "../../analysis/collection.js";
import { buildTreeInfo, type TreeEntry } from "./session-tree.js";
import { redactAndTruncate, redactSessionText } from "./redaction.js";

export interface ParsedPiSession extends PiSessionEvidence {
  /** Lineage only: a forked session references its origin; shared messages
   *  must not be double counted by evidence builders. */
  parentSession?: string;
  entryCount: number;
  branchCount: number;
  abandonedBranchIds: string[];
  abnormalTermination: boolean;
}

interface RawMessage {
  role?: string;
  content?: unknown;
  stopReason?: string;
}

interface RawEntry {
  type?: string;
  id?: string;
  parentId?: string | null;
  prevId?: string | null;
  role?: string;
  roleName?: string;
  text?: string;
  stopReason?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  summary?: string;
  retainedTail?: unknown;
  firstKeptEntryId?: string;
  ts?: string;
  timestamp?: string;
  message?: RawMessage;
}

interface RawHeader extends RawEntry {
  version?: number;
  cwd?: string;
  startedAt?: string;
  name?: string;
  parentSession?: string;
}

const FILE_OPERATION_TOOLS = new Set(["read", "write", "edit"]);
const FILE_OPERATION_ALIASES: Record<string, "read" | "write" | "edit"> = {
  read_file: "read",
  readfile: "read",
  write_file: "write",
  writefile: "write",
  writefile_file: "write",
  edit_file: "edit",
  apply_patch: "edit",
};
const COMMAND_TOOLS = new Set(["bash", "sh", "shell", "run_command", "execute"]);

function normalizeTool(name: string): string {
  return name.trim().toLowerCase();
}

export function extractFileOperation(
  tool: string,
  input: Record<string, unknown>,
): { operation: "read" | "write" | "edit"; path: string } | null {
  const norm = normalizeTool(tool);
  const op = FILE_OPERATION_TOOLS.has(norm as "read")
    ? (norm as "read" | "write" | "edit")
    : FILE_OPERATION_ALIASES[norm];
  if (!op) return null;
  const rawPath = input.path ?? input.file_path ?? input.file ?? input.filePath;
  if (typeof rawPath !== "string" || rawPath.length === 0) return null;
  return { operation: op, path: rawPath };
}

export function extractCommand(input: Record<string, unknown>): string | null {
  const cmd = input.command ?? input.cmd ?? input.script;
  if (typeof cmd === "string" && cmd.length > 0) return cmd;
  return null;
}

function parentIdOf(entry: RawEntry): string | null {
  if (entry.parentId != null) return entry.parentId;
  if (entry.prevId != null) return entry.prevId;
  return null;
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((item): item is { type?: string; text: string } =>
      Boolean(item) && typeof item === "object" && typeof (item as { text?: unknown }).text === "string",
    )
    .filter((item) => item.type === undefined || item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

function normalizeCurrentMessage(entry: RawEntry): RawEntry {
  if (entry.type !== "message" || !entry.message) return entry;
  return {
    ...entry,
    role: entry.message.role,
    text: textFromContent(entry.message.content),
    stopReason: entry.message.stopReason,
    ts: entry.timestamp,
  };
}

/**
 * Parse a Pi JSONL session file (read-only). Never throws for content
 * problems; problems are recorded in `parseWarnings`.
 */
export async function parsePiSession(
  file: string,
  options: { maxTextChars?: number; onIssue?: CollectionReporter } = {},
): Promise<ParsedPiSession> {
  const maxTextChars = options.maxTextChars ?? 2000;
  const parseWarnings: string[] = [];

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    options.onIssue?.({ source: "pi_session", code: "session_unreadable", message: "已找到的会话文件没能读完整。" });
    const message = error instanceof Error ? error.message : String(error);
    return emptySession(file, `unreadable file: ${message}`);
  }

  const lines = raw.split("\n");
  // A session being written right now may end with a partial line: ignore it.
  if (lines.length > 1 && lines[lines.length - 1]!.trim() !== "" && !isCompleteJson(lines[lines.length - 1]!)) {
    parseWarnings.push("ignored incomplete final line (session may be actively written)");
    lines.pop();
  }

  let header: RawHeader | null = null;
  const entries: RawEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: RawEntry | null = null;
    try {
      parsed = JSON.parse(line) as RawEntry;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("session entry must be an object");
      }
    } catch {
      options.onIssue?.({ source: "pi_session", code: "session_invalid_json", message: `会话第 ${index + 1} 行无法解析。` });
      parseWarnings.push(`ignored malformed line ${index + 1}`);
      continue;
    }
    if (parsed.type === "session_header" || parsed.type === "session") {
      if (header === null) {
        header = parsed as RawHeader;
      } else {
        options.onIssue?.({ source: "pi_session", code: "session_invalid_header", message: "会话包含重复头部，内容无法完整确认。" });
        parseWarnings.push(`ignored duplicate header at line ${index + 1}`);
      }
      continue;
    }
    if (typeof parsed.id === "string") {
      entries.push(normalizeCurrentMessage(parsed));
    }
  }

  if (!header) {
    options.onIssue?.({ source: "pi_session", code: "session_invalid_header", message: "会话缺少头部，内容无法完整确认。" });
    return emptySession(file, "missing session header");
  }

  const treeEntries: TreeEntry[] = entries
    .filter((e) => typeof e.id === "string")
    .map((e) => ({ id: e.id!, parentId: parentIdOf(e) }));
  const tree = buildTreeInfo(treeEntries);
  parseWarnings.push(...tree.warnings);
  if (tree.warnings.length > 0) {
    options.onIssue?.({ source: "pi_session", code: "session_invalid_tree", message: "会话的消息关系不完整。" });
  }

  const onActiveBranch = new Set(tree.activeBranch.map((e) => e.id));
  const lastTs =
    [...entries].reverse().find((e) => typeof e.ts === "string")?.ts ??
    header.startedAt ??
    header.timestamp ??
    new Date().toISOString();

  const evidence: ParsedPiSession = {
    sessionId: header.id ?? file,
    file,
    cwd: header.cwd ?? "",
    startedAt: header.startedAt ?? header.timestamp ?? lastTs,
    updatedAt: lastTs,
    activeLeafId: tree.activeLeafId ?? undefined,
    userRequests: [],
    assistantConclusions: [],
    compactions: [],
    fileOperations: [],
    verificationClaims: [],
    parseWarnings,
    entryCount: entries.length,
    branchCount: tree.branchCount,
    abandonedBranchIds: tree.abandonedBranchIds,
    abnormalTermination: false,
  };
  if (typeof header.name === "string" && header.name.length > 0) {
    evidence.name = header.name;
  }
  if (typeof header.parentSession === "string") {
    evidence.parentSession = header.parentSession;
  }

  // tool_result outputs keyed by parent tool_call id.
  const toolResultByParent = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "tool_result" && entry.parentId && typeof entry.output === "string") {
      toolResultByParent.set(entry.parentId, entry.output);
    }
  }

  for (const entry of entries) {
    if (!entry.id) continue;
    const isActive = onActiveBranch.has(entry.id);

    if (entry.type === "message" && isActive) {
      if (entry.role === "user" && typeof entry.text === "string") {
        evidence.userRequests.push({
          entryId: entry.id,
          text: redactAndTruncate(entry.text, maxTextChars),
        });
      } else if ((entry.role === "assistant" || entry.role === "custom") && typeof entry.text === "string") {
        const text = redactAndTruncate(entry.text, maxTextChars);
        const stopReason = entry.stopReason?.toLowerCase();
        if (stopReason === "error" || stopReason === "aborted") {
          evidence.abnormalTermination = true;
          evidence.parseWarnings.push(
            `abnormal termination at entry ${entry.id} (stopReason=${entry.stopReason})`,
          );
        }
        evidence.assistantConclusions.push({
          entryId: entry.id,
          text,
          ...(entry.stopReason ? { stopReason: entry.stopReason } : {}),
        });
      }
    } else if (entry.type === "compaction" && isActive && typeof entry.summary === "string") {
      // Compaction summaries replace earlier tail content; retainedTail /
      // firstKeptEntryId are honored by consumers that need the older tail.
      if (!Array.isArray(entry.retainedTail) && !entry.firstKeptEntryId) {
        evidence.parseWarnings.push(
          `compaction ${entry.id} has neither retainedTail nor firstKeptEntryId`,
        );
      }
      evidence.compactions.push({
        entryId: entry.id,
        summary: redactAndTruncate(entry.summary, maxTextChars),
      });
    } else if (entry.type === "tool_call" && isActive) {
      const op = entry.tool && entry.input ? extractFileOperation(entry.tool, entry.input) : null;
      if (op) {
        evidence.fileOperations.push({ entryId: entry.id, operation: op.operation, path: op.path });
      }
      if (entry.tool && entry.input && COMMAND_TOOLS.has(normalizeTool(entry.tool))) {
        const command = extractCommand(entry.input);
        const rawOutput = toolResultByParent.get(entry.id);
        if (command || rawOutput) {
          evidence.verificationClaims.push({
            entryId: entry.id,
            ...(command ? { command: redactAndTruncate(command, maxTextChars) } : {}),
            claimedResult: rawOutput
              ? redactAndTruncate(rawOutput, maxTextChars)
              : "(no output recorded)",
            confidence: "reported",
          });
        }
      }
    }
  }

  return evidence;
}

function isCompleteJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function emptySession(file: string, warning: string): ParsedPiSession {
  return {
    sessionId: file,
    file,
    cwd: "",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userRequests: [],
    assistantConclusions: [],
    compactions: [],
    fileOperations: [],
    verificationClaims: [],
    parseWarnings: [warning],
    entryCount: 0,
    branchCount: 0,
    abandonedBranchIds: [],
    abnormalTermination: false,
  };
}

export { redactSessionText };