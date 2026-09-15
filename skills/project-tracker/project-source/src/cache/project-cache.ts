/**
 * Pi session discovery for the cache/server: extends the locator with the
 * per-session metadata the dashboard needs (message counts, branch counts,
 * abnormal termination, lineage).
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectScope } from "../contracts.js";
import type { TrackerConfig } from "../config.js";
import { locatePiSessions } from "../adapters/pi/session-locator.js";
import { parsePiSession, type ParsedPiSession } from "../adapters/pi/session-parser.js";

export interface SessionIndexEntry {
  sessionId: string;
  /** Project-relative identifier, never an absolute session path. */
  id: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  name?: string;
  messageCount: number;
  branchCount: number;
  abnormalTermination: boolean;
  firstUserGoal?: string;
  lastUserRequest?: string;
  lastConclusion?: string;
  parentSession?: string;
}

export async function indexProjectSessions(
  scope: ProjectScope,
  config: TrackerConfig,
): Promise<SessionIndexEntry[]> {
  const files = await locatePiSessions(scope, config);
  const parsed: ParsedPiSession[] = [];
  for (const file of files) {
    parsed.push(await parsePiSession(file, { maxTextChars: config.bundleLimits.maxTextChars }));
  }
  parsed.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return parsed.map((s) => {
    const humanRequests = s.userRequests.filter((request) => !/^\s*<skill\b/i.test(request.text));
    return {
      sessionId: s.sessionId,
      id: s.sessionId,
      cwd: s.cwd,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      ...(s.name ? { name: s.name } : {}),
      messageCount: s.userRequests.length + s.assistantConclusions.length,
      branchCount: s.branchCount,
      abnormalTermination: s.abnormalTermination,
      ...(humanRequests[0] ? { firstUserGoal: humanRequests[0]!.text } : {}),
      ...(humanRequests.length > 0
        ? { lastUserRequest: humanRequests[humanRequests.length - 1]!.text }
        : {}),
      ...(s.assistantConclusions.length > 0
        ? { lastConclusion: s.assistantConclusions[s.assistantConclusions.length - 1]!.text }
        : {}),
      ...(s.parentSession ? { parentSession: s.parentSession } : {}),
    };
  });
}

/** Directory listing helper used by the sessions page deep-link building. */
export async function listSessionDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

export { join };