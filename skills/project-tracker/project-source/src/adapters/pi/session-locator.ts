/**
 * Pi session locator (section 3.1 / 3.2).
 *
 * Candidate directories come from config (priority: CLI → env → Pi settings →
 * default). Every *.jsonl is opened read-only; only its first line (the
 * session header) is read for scope filtering. A session belongs to the
 * project when the canonical realpath of its header cwd is within the
 * project root, one of its worktrees, or an explicitly registered path.
 * String-prefix matching is forbidden (adjacent /repo vs /repo-copy).
 */
import { readdir, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectScope } from "../../contracts.js";
import type { TrackerConfig } from "../../config.js";
import type { CollectionReporter } from "../../analysis/collection.js";
import { isWithinPath } from "../../discovery/project-discovery.js";

async function readFirstLine(file: string, onIssue?: CollectionReporter, maxBytes = 65_536): Promise<string | null> {
  try {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      const newlineIndex = text.indexOf("\n");
      return newlineIndex === -1 ? text : text.slice(0, newlineIndex);
    } finally {
      await handle.close();
    }
  } catch {
    onIssue?.({ source: "pi_session", code: "session_unreadable", message: "有会话文件没能读取，无法确认是否属于这个项目。" });
    return null;
  }
}

function scopePaths(scope: ProjectScope): string[] {
  return [scope.root, ...scope.worktrees, ...scope.extraPaths];
}

/** Parse the session header's cwd out of the first line without full parsing. */
export function extractHeaderCwd(firstLine: string): string | null {
  try {
    const parsed = JSON.parse(firstLine) as { type?: string; cwd?: unknown };
    if (
      (parsed.type === "session_header" || parsed.type === "session") &&
      typeof parsed.cwd === "string" &&
      parsed.cwd.length > 0
    ) {
      return parsed.cwd;
    }
  } catch {
    // Header line incomplete or non-JSON: not a Pi session for this scan.
  }
  return null;
}

async function listSessionFiles(root: string, onIssue?: CollectionReporter): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      onIssue?.({ source: "pi_session", code: "session_directory_unreadable", message: "会话目录没能读完整。" });
    }
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
      continue;
    }
    if (!entry.isDirectory()) continue;
    try {
      const children = await readdir(path, { withFileTypes: true });
      for (const child of children) {
        if (child.isFile() && child.name.endsWith(".jsonl")) {
          files.push(join(path, child.name));
        }
      }
    } catch {
      onIssue?.({ source: "pi_session", code: "session_directory_unreadable", message: "已找到的会话子目录没能读完整。" });
    }
  }
  return files;
}

/**
 * Return the Pi session files (absolute paths) that belong to the project.
 */
export async function locatePiSessions(
  scope: ProjectScope,
  config: Pick<TrackerConfig, "piSessionDirs">,
  onIssue?: CollectionReporter,
): Promise<string[]> {
  const paths = scopePaths(scope);
  const results: string[] = [];
  const seen = new Set<string>();

  for (const dir of config.piSessionDirs) {
    const files = await listSessionFiles(dir, onIssue);
    for (const file of files) {
      if (seen.has(file)) continue;
      const firstLine = await readFirstLine(file, onIssue);
      if (firstLine === null) continue;
      const headerCwd = extractHeaderCwd(firstLine);
      if (!headerCwd) {
        onIssue?.({ source: "pi_session", code: "session_invalid_header", message: "有会话头部无法识别，不能确认项目归属。" });
        continue;
      }
      let canonical = headerCwd;
      try {
        canonical = await realpath(headerCwd);
      } catch (error) {
        // Historical sessions may reference a removed checkout; retain their
        // original path. Other failures cannot establish project membership.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          onIssue?.({ source: "pi_session", code: "session_scope_unreadable", message: "有会话的项目路径无法确认，请检查目录访问权限和链接。" });
          continue;
        }
      }
      if (paths.some((p) => isWithinPath(p, canonical))) {
        seen.add(file);
        results.push(file);
      }
    }
  }

  return [...seen];
}

/** All session files in candidate dirs, regardless of scope (for CLI stats). */
export async function countAllSessions(config: Pick<TrackerConfig, "piSessionDirs">): Promise<{
  total: number;
  dirs: number;
}> {
  let total = 0;
  let dirs = 0;
  for (const dir of config.piSessionDirs) {
    try {
      await readdir(dir);
      dirs += 1;
      total += (await listSessionFiles(dir)).length;
    } catch {
      // Directory missing / unreadable: not an error for discovery.
    }
  }
  return { total, dirs };
}