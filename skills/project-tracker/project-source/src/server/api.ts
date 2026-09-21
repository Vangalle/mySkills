/**
 * Read-only local API (section 6.2).
 *
 * No endpoint writes PROJECT_STATE.md; writes happen only through the CLI /
 * Pi skill on the same machine.
 */
import { classifyVerificationRecords, loadVerificationStore, VERIFICATION_STORE_PATH, verificationEvidenceId } from "../verification/index.js";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { buildReferences, detectConflicts } from "../analysis/conflict-detector.js";
import { buildGoalOverview } from "../goals/source-adapter.js";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import type { TrackerConfig } from "../config.js";
import { discoverProject } from "../discovery/project-discovery.js";
import { buildProjectEvidence } from "../analysis/evidence-builder.js";
import { buildBoundedBundle } from "../analysis/bounded-bundle.js";
import { collectGitEvidence } from "../adapters/git-adapter.js";
import { indexProjectSessions } from "../cache/project-cache.js";
import { detectAgentsView, buildSessionDeepLink, type AgentsViewAvailability } from "../integrations/agentsview.js";
import type { ProjectEvidence } from "../contracts.js";
import type { ProjectScope } from "../contracts.js";
import { buildWorkplaneSnapshot } from "../workplane/snapshot.js";
import { createWorkplaneClient, type WorkplaneClient } from "../workplane/client.js";

export interface ProjectRegistry {
  /** Registered project root paths (canonical). */
  projects: string[];
}

export interface ApiContext {
  config: TrackerConfig;
  registry: ProjectRegistry;
  /** Last observed collection for diagnostics; never reused as live State. */
  evidenceCache?: Map<string, ProjectEvidence>;
  /** Explicit collector injection for tests/embedders. */
  collectEvidence?: (scope: ProjectScope) => Promise<ProjectEvidence>;
  /** Where AgentsView can be reached, when available. */
  agentsview?: AgentsViewAvailability;
  /** Optional Workplane plugin client; absent means an uninstalled optional capability. */
  workplane?: WorkplaneClient;
}

async function resolveScope(
  ctx: ApiContext,
  projectId: string,
): Promise<ProjectScope | "not_found" | "not_git" | "bare_repo"> {
  const root = ctx.registry.projects.find((p) => projectIdFor(p) === projectId);
  if (!root) return "not_found";
  const discovery = await discoverProject(root, { extraProjectPaths: ctx.config.extraProjectPaths });
  if (!discovery.ok) return discovery.kind;
  return discovery.scope;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

/** Short, URL-safe, collision-resistant project id. */
function projectIdFor(root: string): string {
  const digest = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${basename(root)}-${digest}`;
}

async function getEvidence(ctx: ApiContext, scope: ProjectScope): Promise<ProjectEvidence> {
  const evidence = ctx.collectEvidence ? await ctx.collectEvidence(scope)
    : await buildProjectEvidence(scope, { config: ctx.config });
  ctx.evidenceCache?.set(scope.root, evidence);
  return evidence;
}

/**
 * Evidence with the persisted latest verification run applied. A later FAIL must
 * be able to replace an older PASS without changing source contents, so every
 * consumer (State and Workplane) shares this preparation.
 */
async function getCurrentEvidence(ctx: ApiContext, scope: ProjectScope): Promise<ProjectEvidence> {
  const cachedEvidence = await getEvidence(ctx, scope);
  const storePresent = await lstat(join(scope.root, VERIFICATION_STORE_PATH)).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
  );
  const verification = !ctx.collectEvidence ? cachedEvidence.verification : storePresent
    ? (await loadVerificationStore(scope.root)).records
    : cachedEvidence.verification.length
      ? await classifyVerificationRecords(scope.root, cachedEvidence.verification)
      : [];
  const currentInputs = { ...cachedEvidence, verification };
  return {
    ...currentInputs,
    references: [
      ...cachedEvidence.references.filter((reference) => reference.source !== "verification"),
      ...buildReferences(currentInputs).filter((reference) => reference.source === "verification"),
    ],
    conflicts: detectConflicts(currentInputs),
  };
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

export async function buildTimeline(evidence: ProjectEvidence): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  for (const commit of evidence.git.recentCommits) {
    entries.push({
      at: commit.authoredAt,
      kind: "commit",
      title: commit.subject,
      source: "git",
      confidence: "observed",
      evidenceId: `git:commit:${commit.hash.slice(0, 10)}`,
      locator: commit.hash,
    });
  }
  for (const session of evidence.sessions) {
    entries.push({
      at: session.startedAt,
      kind: "session",
      title: session.name ?? session.sessionId,
      source: "pi_session",
      confidence: "observed",
      evidenceId: `session:${session.sessionId}`,
      locator: session.sessionId,
    });
    for (const compaction of session.compactions) {
      entries.push({
        at: session.updatedAt,
        kind: "compaction",
        title: compaction.summary.slice(0, 120),
        source: "pi_session",
        confidence: "reported",
        evidenceId: `session:${session.sessionId}`,
        locator: `${session.sessionId}#${compaction.entryId}`,
      });
    }
  }
  for (const [i, record] of evidence.verification.entries()) {
    entries.push({
      at: record.verifiedAt,
      kind: "verification",
      title: `${record.command} → ${record.result}`,
      source: "verification",
      confidence: "observed",
      evidenceId: verificationEvidenceId(record, i),
      locator: record.command,
    });
  }
  if (evidence.existingState?.lastVerified) {
    entries.push({
      at: evidence.existingState.lastVerified,
      kind: "state_update",
      title: `PROJECT_STATE.md last verified (${evidence.existingState.releaseState ?? "unknown"})`,
      source: "project_state",
      confidence: "reported",
      evidenceId: "state:baseline",
      locator: "PROJECT_STATE.md",
    });
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  return entries;
}

export interface StateFreshness {
  stale: boolean;
  reasons: string[];
}

export function computeFreshness(evidence: ProjectEvidence): StateFreshness {
  const reasons: string[] = [];
  const state = evidence.existingState;
  if (!state?.baseline) {
    reasons.push("PROJECT_STATE.md missing or has no baseline");
  } else if (state.baseline.commit !== evidence.git.head) {
    reasons.push("HEAD moved past the recorded baseline");
  }
  if (evidence.git.changed.length > 0) {
    reasons.push("working tree has uncommitted changes");
  }
  if (evidence.verification.length === 0) {
    reasons.push("no verification on record for this scan");
  } else {
    if (evidence.verification.some((record) => record.freshness === "stale")) {
      reasons.push("verification is stale for the current project contents");
    }
    if (evidence.verification.some((record) => !record.freshness || record.freshness === "unbound")) {
      reasons.push("verification is unbound to project contents");
    }
  }
  return { stale: reasons.length > 0, reasons };
}

export async function registerApi(
  app: FastifyInstance,
  ctx: ApiContext,
): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, name: "project-tracker", version: "0.1.0" }));

  app.get("/api/projects", async () => {
    return {
      projects: ctx.registry.projects.map((root) => ({
        id: projectIdFor(root),
        name: basename(root),
        root,
      })),
    };
  });

  app.get("/api/projects/:id/state", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    // A later run may replace PASS with FAIL without changing source contents.
    // Prefer the persisted latest run; injected evidence remains usable only
    // when no store exists. Corrupt/unreadable stores must not revive old PASS.
    const evidence = await getCurrentEvidence(ctx, scope);
    const freshness = computeFreshness(evidence);
    return {
      project: { id: projectIdFor(scope.root), name: scope.name, root: scope.root },
      releaseState: evidence.existingState?.releaseState ?? null,
      proposal: evidence.existingState?.proposal ?? null,
      collectedAt: evidence.collectedAt,
      goalOverview: await buildGoalOverview(scope.root, evidence.existingState?.proposal?.goals, evidence,
        evidence.existingState?.proposal?.schemaVersion === 2 ? evidence.existingState.proposal.projectGoal : null,
        evidence.existingState?.proposal?.verification ?? []),
      git: {
        branch: evidence.git.branch,
        head: evidence.git.head,
        ahead: evidence.git.ahead,
        behind: evidence.git.behind,
        dirtyCount: evidence.git.changed.length,
      },
      conflicts: evidence.conflicts,
      verification: evidence.verification,
      freshness,
    };
  });

  app.get("/api/projects/:id/workplane", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    const client = ctx.workplane ?? createWorkplaneClient();
    const evidence = await getCurrentEvidence(ctx, scope);
    const snapshot = buildWorkplaneSnapshot(evidence);
    return client.evaluate({ root: scope.root, snapshot });
  });

  app.get("/api/projects/:id/evidence", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    const evidence = await getEvidence(ctx, scope);
    const { existingState, ...rest } = evidence;
    void existingState;
    return { ...rest, freshness: computeFreshness(evidence) };
  });

  app.get("/api/projects/:id/timeline", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    const evidence = await getEvidence(ctx, scope);
    return { timeline: await buildTimeline(evidence) };
  });

  app.get("/api/projects/:id/sessions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    const sessions = await indexProjectSessions(scope, ctx.config);
    const agentsview = ctx.agentsview ?? (await detectAgentsView());
    return {
      sessions,
      agentsview: {
        available: agentsview.available,
        deepLinks: agentsview.available
          ? sessions.map((s) => ({
              sessionId: s.sessionId,
              url: buildSessionDeepLink(agentsview, s.sessionId),
            }))
          : [],
      },
    };
  });

  app.post("/api/projects/:id/rescan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    ctx.evidenceCache?.delete(scope.root);
    const evidence = await getEvidence(ctx, scope);
    const bundle = buildBoundedBundle(evidence, ctx.config.bundleLimits);
    return { collectedAt: evidence.collectedAt, sessions: evidence.sessions.length, estimatedTokens: bundle.estimatedTokens };
  });

  app.get("/api/projects/:id/bundle", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    const evidence = await getEvidence(ctx, scope);
    return buildBoundedBundle(evidence, ctx.config.bundleLimits);
  });

  app.get("/api/projects/:id/git", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scope = await resolveScope(ctx, id);
    if (typeof scope === "string") {
      return reply.code(404).send({ error: "not_found", message: `unknown project: ${id}` });
    }
    return collectGitEvidence(scope);
  });
}
