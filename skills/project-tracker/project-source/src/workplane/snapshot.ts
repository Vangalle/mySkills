/**
 * Tracker → Workplane snapshot.
 *
 * This is a bounded, read-only projection of Tracker-owned data: Goals, Design
 * history, and verification freshness. It deliberately excludes sessions, raw
 * document bodies, conflicts and `PROJECT_STATE.md` markdown. Tracker never
 * asks Workplane to infer relationships; the snapshot only carries canonical
 * identities and explicit ancestry.
 */
import { createHash } from "node:crypto";
import type { ProjectEvidence } from "../contracts.js";
import type { WorkplaneTrackerSnapshot } from "./protocol.js";

interface RawProgress {
  id: string;
  recordedAt: string;
  text: string;
  evidenceIds?: string[];
  gitRefs?: string[];
}
interface RawAcceptance {
  id: string;
  criterion: string;
  complete?: boolean;
  evidenceIds?: string[];
}
interface RawDesign {
  id: string;
  title: string;
  path: string;
  parents?: string[] | null;
  progress?: RawProgress[];
  acceptance?: RawAcceptance[];
}
interface RawGoal {
  id: string;
  title: string;
  designs?: RawDesign[];
}
interface RawProposal {
  schemaVersion?: number;
  projectGoal?: { statement: string } | null;
  goals?: RawGoal[];
}

function normalizeDesign(raw: RawDesign) {
  return {
    id: raw.id,
    title: raw.title,
    path: raw.path,
    parents: Array.isArray(raw.parents) ? raw.parents : null,
    progress: (raw.progress ?? []).map((record) => ({
      id: record.id,
      recordedAt: record.recordedAt,
      text: record.text,
      evidenceIds: record.evidenceIds ?? [],
      gitRefs: record.gitRefs ?? [],
    })),
    acceptance: (raw.acceptance ?? []).map((item) => ({
      id: item.id,
      criterion: item.criterion,
      complete: item.complete ?? false,
      evidenceIds: item.evidenceIds ?? [],
    })),
  };
}

export function buildWorkplaneSnapshot(evidence: ProjectEvidence): WorkplaneTrackerSnapshot {
  const proposal = (evidence.existingState?.proposal ?? null) as unknown as RawProposal | null;
  const projectGoal =
    proposal?.schemaVersion === 2 && proposal.projectGoal
      ? { statement: proposal.projectGoal.statement }
      : null;
  const goals = (proposal?.goals ?? []).map((goal) => ({
    id: goal.id,
    title: goal.title,
    designs: (goal.designs ?? []).map(normalizeDesign),
  }));

  return {
    schemaVersion: 1,
    project: { name: evidence.project.name, root: evidence.project.root },
    projectGoal,
    goals,
    git: { head: evidence.git.head },
    verification: evidence.verification.map((record) => ({
      id: record.id,
      command: record.command,
      result: record.result,
      verifiedAt: record.verifiedAt,
      freshness: record.freshness ?? "unbound",
    })),
  };
}

/**
 * Hash only reviewed definitions: Project Goal, Feature Goal and Design
 * identity/content, explicit ancestry, source path and acceptance meaning/state.
 * Daily Progress, Git HEAD and verification changes must not invalidate a
 * reviewed definition preview.
 */
export function trackerStructureHash(snapshot: WorkplaneTrackerSnapshot): string {
  const structure = [
    snapshot.projectGoal?.statement ?? null,
    snapshot.goals.map((goal) => [
      goal.id,
      goal.title,
      goal.designs.map((design) => [
        design.id,
        design.title,
        design.path,
        design.parents ?? null,
        design.acceptance.map((item) => [item.id, item.criterion, item.complete, item.evidenceIds]),
      ]),
    ]),
  ];
  return createHash("sha256").update(JSON.stringify(structure)).digest("hex");
}
