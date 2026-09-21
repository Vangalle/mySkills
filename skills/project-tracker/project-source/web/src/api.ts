/** Typed client for the read-only local API. */
import type { GoalOverview } from "../../src/goals/types";
export type { GoalOverview, GoalSource } from "../../src/goals/types";

export interface ProjectSummary {
  id: string;
  name: string;
  root: string;
}

export interface StateResponse {
  project: { id: string; name: string; root: string };
  goalOverview?: GoalOverview;
  releaseState: "STABLE" | "ACTIVE" | "BLOCKED" | null;
  proposal: {
    schemaVersion?: 1 | 2;
    executiveSummary?: string;
    currentMilestone?: { objective: string; exitCriteria: string[] };
    workstreams?: Array<{
      name: string;
      status: string;
      claimMaturity: "CODE_EXISTS" | "DEMO_VERIFIED" | "LOCAL_PROTOTYPE_VERIFIED" | "PRODUCTION_VERIFIED";
      stableBaseline: string;
      currentGap: string;
      evidenceIds: string[];
    }>;
    activeWork?: Array<{ name: string; status: string; completed: string[]; remaining: string[] }>;
    risks?: Array<{ severity: "P0" | "P1" | "P2"; problem: string; impact: string; nextAction: string }>;
    nextActions?: Array<{ priority: "P0" | "P1" | "P2"; action: string }>;
  } | null;
  git: { branch: string | null; head: string; ahead: number; behind: number; dirtyCount: number };
  conflicts: Array<{ id: string; kind: string; severity: "P0" | "P1" | "P2"; description: string }>;
  verification: Array<{
    command: string;
    result: "PASS" | "FAIL" | "ERROR";
    verifiedAt: string;
    outputSummary: string;
    freshness?: "current" | "stale" | "unbound";
  }>;
  freshness: { stale: boolean; reasons: string[] };
}

export interface TimelineEntry {
  at: string;
  kind: "commit" | "session" | "compaction" | "verification" | "state_update";
  title: string;
  source: "git" | "pi_session" | "verification" | "project_state";
  confidence: "observed" | "reported" | "inferred";
  evidenceId: string;
  locator: string;
}

export interface SessionIndexEntry {
  sessionId: string;
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

export interface SessionsResponse {
  sessions: SessionIndexEntry[];
  agentsview: {
    available: boolean;
    deepLinks: Array<{ sessionId: string; url: string }>;
  };
}

export type WorkplaneApiResponse =
  | { status: "ready"; document: unknown; html: string; mermaid: string }
  | {
      status: "not_configured" | "unavailable" | "incompatible" | "invalid" | "failed";
      message: string;
      errors?: string[];
    };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`request failed: ${url} → ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  listProjects: () => fetchJson<{ projects: ProjectSummary[] }>("/api/projects"),
  getState: (id: string) => fetchJson<StateResponse>(`/api/projects/${encodeURIComponent(id)}/state`),
  getTimeline: (id: string) =>
    fetchJson<{ timeline: TimelineEntry[] }>(`/api/projects/${encodeURIComponent(id)}/timeline`),
  getSessions: (id: string) =>
    fetchJson<SessionsResponse>(`/api/projects/${encodeURIComponent(id)}/sessions`),
  getWorkplane: (id: string) =>
    fetchJson<WorkplaneApiResponse>(`/api/projects/${encodeURIComponent(id)}/workplane`),
  rescan: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}/rescan`, { method: "POST" }),
};
