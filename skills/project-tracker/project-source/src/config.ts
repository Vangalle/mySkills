/**
 * Tracker configuration with documented resolution priority:
 *
 *   CLI overrides / explicit callers
 *   → PI_CODING_AGENT_SESSION_DIR environment variable
 *   → Pi settings.json sessionDir
 *   → ~/.pi/agent/sessions (default)
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeKanbanUrl, type BoardConfig } from "./integrations/kanban.js";
import type { CollectionReporter } from "./analysis/collection.js";
import type { CollectionIssue } from "./contracts.js";

export interface BundleLimits {
  /** Max sessions included as metadata in the bounded bundle. */
  maxSessionsMetadata: number;
  /** Max sessions with full active-branch user requests + conclusions. */
  maxSessionsDetailed: number;
  /** Max characters kept per extracted text block. */
  maxTextChars: number;
  /** Max recent commits in the bundle. */
  maxCommits: number;
  /** Overall character budget for the bundle. */
  maxTotalChars: number;
}

export interface TrackerConfig {
  /** Carried into scans even when callers do not subscribe to diagnostics. */
  collectionIssues?: CollectionIssue[];
  /** Resolved Pi session directories in priority order (first wins). */
  piSessionDirs: string[];
  extraProjectPaths: string[];
  /** Commands that `verify` is allowed to execute. Empty = nothing runs. */
  verificationAllowlist: string[];
  cacheDir: string;
  stateFileName: string;
  bundleLimits: BundleLimits;
}

export const DEFAULT_BUNDLE_LIMITS: BundleLimits = {
  maxSessionsMetadata: 30,
  maxSessionsDetailed: 10,
  maxTextChars: 2000,
  maxCommits: 30,
  maxTotalChars: 120_000,
};

export const PI_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

function readSettingsSessionDir(onIssue?: CollectionReporter): string | null {
  const candidates = [
    join(homedir(), ".pi", "agent", "settings.json"),
    join(homedir(), ".pi", "settings.json"),
  ];
  for (const file of candidates) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid settings object");
      }
      const sessionDir = (parsed as { sessionDir?: unknown }).sessionDir;
      if (sessionDir !== undefined) {
        if (typeof sessionDir !== "string" || sessionDir.length === 0) throw new Error("invalid sessionDir");
        return sessionDir;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        onIssue?.({ source: "configuration", code: "settings_unreadable", message: "Pi 配置没能读完整，无法确认会话目录。" });
        return null;
      }
    }
  }
  return null;
}

/**
 * Choose the highest-priority configured session directory. Do not filter
 * with existsSync: actual reads must distinguish absent from inaccessible.
 * Callers can pass multiple roots explicitly via overrides.piSessionDirs.
 */
export function resolvePiSessionDirs(
  env: Record<string, string | undefined> = process.env,
  onIssue?: CollectionReporter,
): string[] {
  if (env[PI_SESSION_DIR_ENV] && env[PI_SESSION_DIR_ENV]!.length > 0) {
    return [env[PI_SESSION_DIR_ENV]!];
  }
  const fromSettings = readSettingsSessionDir(onIssue);
  return [fromSettings ?? join(homedir(), ".pi", "agent", "sessions")];
}

/** Project-level config file (.project-tracker.json in the repo root). */
export interface ProjectConfigFile {
  verificationAllowlist?: string[];
  extraProjectPaths?: string[];
  /** Independent local task-board project URL; HTTP loopback only. */
  kanbanUrl?: string;
}

export function loadProjectBoard(root: string): BoardConfig {
  const value = loadProjectConfigFile(root)?.kanbanUrl;
  if (value === undefined) return { status: "unconfigured", url: null };
  const url = normalizeKanbanUrl(value);
  return url ? { status: "configured", url } : { status: "invalid_config", url: null };
}

export function loadProjectConfigFile(
  root: string,
): ProjectConfigFile {
  for (const name of [".project-tracker.json", "project-tracker.json"]) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ProjectConfigFile;
    } catch {
      // malformed project config: ignore, stay read-only-safe
    }
  }
  return {};
}

export function loadTrackerConfig(
  overrides: Partial<TrackerConfig> = {},
  env: Record<string, string | undefined> = process.env,
  onIssue?: CollectionReporter,
): TrackerConfig {
  const collectionIssues = [...(overrides.collectionIssues ?? [])];
  const report: CollectionReporter = (issue) => {
    collectionIssues.push(issue);
    onIssue?.(issue);
  };
  return {
    piSessionDirs: overrides.piSessionDirs ?? resolvePiSessionDirs(env, report),
    collectionIssues,
    extraProjectPaths: overrides.extraProjectPaths ?? [],
    verificationAllowlist: overrides.verificationAllowlist ?? [],
    cacheDir: overrides.cacheDir ?? join(homedir(), ".cache", "project-tracker"),
    stateFileName: overrides.stateFileName ?? "PROJECT_STATE.md",
    bundleLimits: overrides.bundleLimits ?? DEFAULT_BUNDLE_LIMITS,
  };
}
