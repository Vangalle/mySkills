/**
 * Optional AgentsView integration (section 7.1 / Task 9).
 *
 * Read-only feature detection + safe deep links. The native parser remains
 * the required fallback: if AgentsView is unavailable the UI silently falls
 * back to the built-in session summary. We never put absolute filesystem
 * paths or tokens into browser URLs.
 */
import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

export interface AgentsViewAvailability {
  available: boolean;
  reason?: string;
  baseUrl?: string;
  version?: string;
  /** How the availability was determined (for explainable UI fallback). */
  detection: "binary" | "api" | "missing" | "unreachable" | "unsupported";
}

const SUPPORTED_API_VERSION = 1;

async function defaultCommandExists(): Promise<boolean> {
  const which = await execa("command", ["-v", "agentsview"], { shell: true, reject: false });
  return !which.failed;
}

function defaultAgentsViewUrl(): string {
  const fromEnv = process.env.AGENTSVIEW_URL;
  if (fromEnv) return fromEnv;
  return "http://127.0.0.1:3100";
}

export interface DetectionOptions {
  /** Injectable for tests: resolves when the agentsview binary exists. */
  commandExists?: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Detect AgentsView without ever writing to it. */
export async function detectAgentsView(options: DetectionOptions = {}): Promise<AgentsViewAvailability> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? defaultAgentsViewUrl();
  const commandExists = options.commandExists ?? defaultCommandExists;

  // 1. Is the CLI installed?
  if (!(await commandExists())) {
    return {
      available: false,
      reason: "agentsview binary not found",
      detection: "missing",
    };
  }

  // 2. Is the daemon reachable and is the API version supported?
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { available: false, reason: `agentsview daemon not running (${response.status})`, detection: "unreachable" };
    }
    const body = (await response.json()) as { apiVersion?: number; version?: string };
    if (typeof body.apiVersion === "number" && body.apiVersion > SUPPORTED_API_VERSION) {
      return {
        available: false,
        reason: `agentsview api version ${body.apiVersion} unsupported (expect ${SUPPORTED_API_VERSION})`,
        detection: "unsupported",
      };
    }
    return { available: true, baseUrl, version: body.version, detection: "api" };
  } catch {
    return { available: false, reason: "agentsview daemon not running", detection: "unreachable" };
  }
}

/**
 * Build a safe deep link to an AgentsView session. Only the session ID is
 * encoded — never an absolute filesystem path, never a token.
 */
export function buildSessionDeepLink(
  availability: AgentsViewAvailability,
  sessionId: string,
): string {
  if (!availability.available || !availability.baseUrl) return "";
  const url = new URL(availability.baseUrl);
  url.pathname = `/sessions/${encodeURIComponent(sessionId)}`;
  return url.toString();
}

/** Read the session summary for a session id from AgentsView if available. */
export async function readAgentsViewSession(
  availability: AgentsViewAvailability,
  sessionId: string,
  options: Pick<DetectionOptions, "fetchImpl"> = {},
): Promise<unknown | null> {
  if (!availability.available || !availability.baseUrl) return null;
  try {
    const url = new URL(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      availability.baseUrl,
    );
    const response = await (options.fetchImpl ?? fetch)(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** True when AgentsView already tracks this projects session dir. */
export async function tracksSessionDir(
  sessionDir: string,
  options: { homeDir?: string } = {},
): Promise<boolean> {
  const home = options.homeDir ?? os.homedir();
  const settingsCandidates = [
    join(home, ".config", "agentsview", "settings.json"),
    join(home, ".agentsview", "settings.json"),
  ];
  for (const file of settingsCandidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { sessionDirs?: string[] };
      if (Array.isArray(parsed.sessionDirs) && parsed.sessionDirs.includes(sessionDir)) {
        return true;
      }
    } catch {
      // ignore malformed settings
    }
  }
  return false;
}