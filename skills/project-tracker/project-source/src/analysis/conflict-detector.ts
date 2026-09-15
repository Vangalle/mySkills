/**
 * Evidence fusion and conflict detection (sections 2.1 / 3.4).
 *
 * Priority: current verification > current git/filesystem observation >
 * verified PROJECT_STATE baseline > session conclusions with tool output >
 * assistant claims > semantic inference. Conflicts are surfaced explicitly —
 * stale session claims never silently win.
 */
import type {
  EvidenceConflict,
  EvidenceRef,
  GitEvidence,
  ParsedProjectState,
  PiSessionEvidence,
  ProjectBoundary,
  Severity,
  VerificationRecord,
} from "../contracts.js";
import { isCompletionClaim } from "../adapters/pi/session-tree.js";
import { redactSessionText } from "../adapters/pi/redaction.js";
import { verificationEvidenceId } from "../verification/index.js";

export interface ConflictInputs {
  git: GitEvidence;
  sessions: PiSessionEvidence[];
  existingState?: ParsedProjectState | null;
  boundaries?: ProjectBoundary[];
  verification: VerificationRecord[];
}

/** Heuristic: does a session claim look like "all green"? */
export function claimsGreen(claimedResult: string): boolean {
  const lower = claimedResult
    .toLowerCase()
    // "0 failed" / "no failures" mean green — neutralize before the negative scan.
    .replace(/(0 failed|no failures|zero failures|without failures)/g, "");
  const positive = /(passed|all .*pass|green|tests? ok)/.test(lower);
  const negative = /(failed|failing|error|red\b)/.test(lower);
  return positive && !negative;
}

function refId(kind: string, ...parts: string[]): string {
  return [kind, ...parts].filter(Boolean).join(":");
}

export function buildReferences(inputs: ConflictInputs): EvidenceRef[] {
  const { git, sessions, existingState, boundaries = [], verification } = inputs;
  const now = new Date().toISOString();
  const refs: EvidenceRef[] = [];

  refs.push({
    id: "git:head",
    source: "git",
    confidence: "observed",
    observedAt: now,
    locator: git.head,
    summary: `HEAD is at ${git.head.slice(0, 12)}${git.branch ? ` on ${git.branch}` : " (detached)"}`,
  });
  if (git.branch) {
    refs.push({
      id: "git:branch",
      source: "git",
      confidence: "observed",
      observedAt: now,
      locator: git.branch,
      summary: git.upstream
        ? `branch ${git.branch} tracks ${git.upstream} (ahead ${git.ahead}, behind ${git.behind})`
        : `branch ${git.branch} has no upstream`,
    });
  }
  if (git.changed.length > 0) {
    refs.push({
      id: "git:status",
      source: "git",
      confidence: "observed",
      observedAt: now,
      locator: git.head,
      summary: `working tree has ${git.changed.length} changed path(s)`,
    });
  }
  for (const commit of git.recentCommits) {
    refs.push({
      id: refId("git:commit", commit.hash.slice(0, 10)),
      source: "git",
      confidence: "reported",
      observedAt: commit.authoredAt,
      locator: commit.hash,
      summary: commit.subject,
    });
  }
  for (const worktree of git.worktrees) {
    refs.push({
      id: refId("git:worktree", worktree.path),
      source: "git",
      confidence: "observed",
      observedAt: now,
      locator: worktree.path,
      summary: `worktree at ${worktree.branch ?? "detached"}`,
    });
  }

  for (const boundary of boundaries) {
    refs.push({
      id: boundary.id,
      source: "project_boundary",
      confidence: "normative",
      observedAt: now,
      locator: `${boundary.sourcePath}:${boundary.line}`,
      summary: boundary.statement,
    });
  }

  for (const session of sessions) {
    refs.push({
      id: refId("session", session.sessionId),
      source: "pi_session",
      confidence: "observed",
      observedAt: session.updatedAt,
      locator: session.sessionId,
      summary: redactSessionText(
        (session.name ?? session.userRequests[0]?.text ?? "pi session").slice(0, 160),
      ).text,
    });
    for (const conclusion of session.assistantConclusions) {
      refs.push({
        id: refId("session", session.sessionId, "conclusion", conclusion.entryId),
        source: "pi_session",
        confidence: isCompletionClaim(conclusion.stopReason) ? "reported" : "inferred",
        observedAt: session.updatedAt,
        locator: `${session.sessionId}#${conclusion.entryId}`,
        summary: redactSessionText(conclusion.text.slice(0, 160)).text,
      });
    }
    for (const claim of session.verificationClaims) {
      refs.push({
        id: refId("session", session.sessionId, "claim", claim.entryId),
        source: "pi_session",
        confidence: "reported",
        observedAt: session.updatedAt,
        locator: `${session.sessionId}#${claim.entryId}`,
        summary: redactSessionText(
          `${claim.command ?? "(command)"} → ${claim.claimedResult.slice(0, 160)}`,
        ).text,
      });
    }
  }

  if (existingState) {
    refs.push({
      id: "state:baseline",
      source: "project_state",
      confidence: "reported",
      observedAt: existingState.baseline?.verifiedAt ?? now,
      locator: existingState.baseline?.commit ?? "unknown",
      summary: existingState.baseline
        ? `PROJECT_STATE baseline ${existingState.baseline.branch ?? "detached"} @ ${existingState.baseline.commit}`
        : "PROJECT_STATE.md has no baseline recorded",
    });
    if (existingState.releaseState) {
      refs.push({
        id: "state:release",
        source: "project_state",
        confidence: "reported",
        observedAt: existingState.lastVerified ?? now,
        locator: "PROJECT_STATE.md",
        summary: `recorded release state: ${existingState.releaseState}`,
      });
    }
  }

  for (const [i, record] of verification.entries()) {
    refs.push({
      id: verificationEvidenceId(record, i),
      source: "verification",
      confidence: "observed",
      observedAt: record.verifiedAt,
      locator: record.command,
      summary: `${record.command} → ${record.result}: ${record.outputSummary.slice(0, 160)}`,
    });
  }

  return refs;
}

export function detectConflicts(inputs: ConflictInputs): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  const { git, sessions, existingState, boundaries = [], verification } = inputs;

  // 1. Stale verification claims: a session said "all green", current
  //    verification says FAIL — current reproducible evidence wins.
  const failingNow = verification.filter((v) => v.result !== "PASS" && v.freshness !== "stale");
  if (failingNow.length > 0) {
    for (const session of sessions) {
      for (const claim of session.verificationClaims) {
        if (claimsGreen(claim.claimedResult)) {
          const failedRecord = failingNow[0]!;
          const observedRef = verificationEvidenceId(
            failedRecord,
            verification.indexOf(failedRecord),
          );
          conflicts.push({
            id: refId("conflict", "stale-verification", session.sessionId, claim.entryId),
            kind: "stale_verification_claim",
            severity: "P0",
            description:
              `Session ${session.sessionId} claims verification is green ("${claim.claimedResult.slice(0, 80)}") ` +
              `but current verification failed (${failingNow[0]!.command}: ${failingNow[0]!.result}). ` +
              "Current reproducible evidence wins; release state must be at least BLOCKED.",
            claimedEvidenceId: refId("session", session.sessionId, "claim", claim.entryId),
            observedEvidenceId: observedRef,
          });
        }
      }
    }
  }

  // 2. Baseline drift: HEAD moved past the recorded PROJECT_STATE baseline.
  if (existingState?.baseline && existingState.baseline.commit !== git.head) {
    conflicts.push({
      id: "conflict:baseline-drift",
      kind: "baseline_drift",
      severity: "P1",
      description:
        `PROJECT_STATE.md baseline is ${existingState.baseline.commit.slice(0, 12)} but HEAD is ` +
        `${git.head.slice(0, 12)}; the recorded state is stale relative to current Git history.`,
      claimedEvidenceId: "state:baseline",
      observedEvidenceId: "git:head",
    });
  }

  // 3. Boundary drift: the current, explicitly marked project limits are
  //    absent from the recorded state. This is structural drift; semantic
  //    interpretation remains in the model-facing bundle and proposal review.
  if (existingState?.proposal && boundaries.length > 0) {
    const recordedBoundaryIds = new Set(
      existingState.proposal.boundaries.flatMap((boundary) => boundary.evidenceIds),
    );
    for (const boundary of boundaries) {
      if (recordedBoundaryIds.has(boundary.id)) continue;
      conflicts.push({
        id: refId("conflict", "project-boundary-drift", boundary.id),
        kind: "project_boundary_drift",
        severity: "P1",
        description:
          `PROJECT_STATE.md does not reflect the current project boundary: "${boundary.statement.slice(0, 160)}". ` +
          "Refresh the state before treating prior completion claims as current.",
        claimedEvidenceId: "state:baseline",
        observedEvidenceId: boundary.id,
      });
    }
  }

  // 4. Dirty baseline: state claims STABLE while the tree is dirty.
  if (existingState?.releaseState === "STABLE" && git.changed.length > 0) {
    conflicts.push({
      id: "conflict:dirty-baseline",
      kind: "dirty_baseline",
      severity: "P1",
      description:
        `PROJECT_STATE.md declares STABLE but the working tree has ${git.changed.length} uncommitted change(s).`,
      claimedEvidenceId: "state:release",
      observedEvidenceId: "git:status",
    });
  }

  // 5. Stale release state: recorded BLOCKED-relevant conflicts exist but
  //    the state still says STABLE.
  if (existingState?.releaseState === "STABLE" && conflicts.some((c) => c.severity === "P0")) {
    conflicts.push({
      id: "conflict:stale-release-state",
      kind: "stale_release_state",
      severity: "P2",
      description:
        "PROJECT_STATE.md still declares STABLE while a P0 conflict exists against current evidence.",
      claimedEvidenceId: "state:release",
      observedEvidenceId: "git:head",
    });
  }

  return conflicts;
}

/**
 * Evidence-priority downgrade: any P0 conflict forces the release state to at
 * least BLOCKED. Old session conclusions never override current evidence.
 */
export function downgradeReleaseState(
  proposed: "STABLE" | "ACTIVE" | "BLOCKED",
  conflicts: EvidenceConflict[],
): "STABLE" | "ACTIVE" | "BLOCKED" {
  const hasP0 = conflicts.some((c) => c.severity === "P0");
  if (hasP0) return "BLOCKED";
  if (proposed === "STABLE" && conflicts.some((c: { severity: Severity }) => c.severity === "P1")) {
    return "ACTIVE";
  }
  return proposed;
}
