/**
 * Bounded analysis bundle for the model (section 3.5).
 *
 * Budgets are enforced by provenance and freshness, never by arbitrary file
 * order: P0 conflicts and fresh verification survive truncation; the oldest
 * sessions are dropped first. Parent/child session lineage is deduped so
 * forked sessions do not double-count shared messages.
 */
import type { ProjectEvidence } from "../contracts.js";
import type { BundleLimits } from "../config.js";
import { findExplicitUserCorrections } from "./project-boundaries.js";
import { verificationEvidenceId } from "../verification/index.js";

export interface AnalysisBundle {
  content: string;
  estimatedTokens: number;
  truncations: string[];
}

interface SessionWithMeta {
  sessionId: string;
  name?: string;
  updatedAt: string;
  parentSession?: string;
  userRequests: Array<{ entryId: string; text: string }>;
  conclusions: Array<{ entryId: string; text: string }>;
  verificationClaims: Array<{ entryId: string; command?: string; claimedResult: string }>;
}

function toMeta(session: ProjectEvidence["sessions"][number], parentSession?: string): SessionWithMeta {
  return {
    sessionId: session.sessionId,
    ...(session.name ? { name: session.name } : {}),
    updatedAt: session.updatedAt,
    ...(parentSession ? { parentSession } : {}),
    userRequests: session.userRequests,
    conclusions: session.assistantConclusions,
    verificationClaims: session.verificationClaims,
  };
}

export function buildBoundedBundle(
  evidence: ProjectEvidence,
  limits: BundleLimits,
  sessionLineage: Map<string, string | undefined> = new Map(),
): AnalysisBundle {
  const truncations: string[] = [];

  // --- sessions, newest first, lineage-aware
  const sessions = evidence.sessions.map((s) => toMeta(s, sessionLineage.get(s.sessionId)));

  const metadataSessions = sessions.slice(0, limits.maxSessionsMetadata);
  if (sessions.length > limits.maxSessionsMetadata) {
    truncations.push(`sessions metadata limited to ${limits.maxSessionsMetadata} of ${sessions.length} (oldest dropped)`);
  }

  const detailedSessions = metadataSessions.slice(0, limits.maxSessionsDetailed);
  if (metadataSessions.length > limits.maxSessionsDetailed) {
    truncations.push(`detailed sessions limited to ${limits.maxSessionsDetailed} (oldest dropped)`);
  }

  // Lineage dedup: when a session and its parent are both detailed, shared
  // conclusion texts are emitted only for the fresher (child) session.
  const emittedConclusionTexts = new Set<string>();
  for (const session of detailedSessions) {
    if (!session.parentSession) continue;
    for (const other of detailedSessions) {
      if (other.sessionId === session.parentSession) {
        for (const conclusion of other.conclusions) {
          emittedConclusionTexts.add(conclusion.text);
        }
      }
    }
  }

  // --- commits
  const commits = evidence.git.recentCommits.slice(0, limits.maxCommits);
  if (evidence.git.recentCommits.length > limits.maxCommits) {
    truncations.push(`commits limited to ${limits.maxCommits} (oldest dropped)`);
  }

  const truncate = (text: string) =>
    text.length <= limits.maxTextChars ? text : `${text.slice(0, limits.maxTextChars)}…`;

  const lines: string[] = [];
  lines.push("# Project Evidence Bundle", "");
  lines.push(
    `project: ${evidence.project.name} (${evidence.project.root})`,
    `collectedAt: ${evidence.collectedAt}`,
    "evidenceRule: commit subjects describe code changes, not business completion",
    "",
  );

  lines.push("## Conflicts (must be reflected in the proposal)", "");
  if (evidence.conflicts.length === 0) {
    lines.push("_No conflicts between current evidence and recorded history._", "");
  } else {
    const sorted = [...evidence.conflicts].sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "P0" ? -1 : b.severity === "P0" ? 1 : 0,
    );
    for (const conflict of sorted) {
      lines.push(`- [${conflict.severity}] ${conflict.kind}: ${truncate(conflict.description)}`);
    }
    lines.push("");
  }

  if (evidence.boundaries.length > 0) {
    lines.push("## Project boundaries (normative; do not contradict)", "");
    for (const boundary of evidence.boundaries) {
      lines.push(`- [${boundary.id}] ${truncate(boundary.statement)} (${boundary.sourcePath}:${boundary.line})`);
    }
    lines.push("");
  }

  const corrections = findExplicitUserCorrections(
    sessions.flatMap((session) =>
      session.userRequests.map((request) => ({
        sessionId: session.sessionId,
        entryId: request.entryId,
        text: request.text,
        updatedAt: session.updatedAt,
      })),
    ),
  );
  if (corrections.length > 0) {
    lines.push("## Explicit user corrections (high priority; preserve under budget)", "");
    for (const correction of corrections) {
      lines.push(
        `- [session:${correction.sessionId}#${correction.entryId}] ${truncate(correction.text)}`,
      );
    }
    lines.push("");
  }

  const checks = evidence.verification.map((record, i) => ({ record, id: verificationEvidenceId(record, i) }));
  if (!checks.length) lines.push("## Current verification", "", "_No verification has been executed for this scan._", "");
  for (const current of [true, false]) {
    const group = checks.filter(({ record }) => (record.freshness === "current") === current);
    if (!group.length) continue;
    lines.push(current ? "## Current verification" : "## Historical / unbound verification — not current acceptance", "");
    for (const { record, id } of group) {
      lines.push(`- [${record.freshness ?? "unbound"}] [${id}] ${record.command} → ${record.result} (${record.verifiedAt}): ${truncate(record.outputSummary)}`);
      if (record.binding) lines.push(`  binding: ${record.binding.projectRoot} HEAD=${record.binding.head} workspace=${record.binding.contentFingerprint} stable=${record.binding.stable}`);
    }
    lines.push("");
  }

  if (evidence.documents) {
    lines.push("## Goal origins and Constitution documents", "",
      "Deduce Project Goal from Philosophy / Insight and PMF / Market, not from a milestone or Git history.");
    for (const doc of evidence.documents) {
      lines.push(`### ${doc.path} — ${doc.status}${doc.truncated ? " (incomplete)" : ""}`);
      if (doc.evidenceId) lines.push(`[${doc.evidenceId}]`);
      if (doc.status === "available") {
        lines.push(truncate(doc.preview));
        if (doc.preview.length > limits.maxTextChars) truncations.push(`${doc.path} excerpt truncated; read the source before deduction`);
      }
      lines.push("");
    }
  }

  lines.push("## Existing PROJECT_STATE.md", "");
  lines.push(
    evidence.existingState?.proposal
      ? JSON.stringify(evidence.existingState.proposal)
      : evidence.existingState
        ? "_Existing PROJECT_STATE.md is incompatible. Inspect it and obtain a replacement/backup decision; do not treat it as missing._"
        : "_No PROJECT_STATE.md present._",
    "",
  );

  lines.push("## Git status", "");
  lines.push(
    `branch: ${evidence.git.branch ?? "detached"}, HEAD: ${evidence.git.head}`,
    `upstream: ${evidence.git.upstream ?? "none"} (ahead ${evidence.git.ahead}, behind ${evidence.git.behind})`,
    `dirty paths: ${evidence.git.changed.length}`,
  );
  if (evidence.git.changed.length > 0) {
    for (const change of evidence.git.changed.slice(0, 50)) {
      lines.push(`- ${change.index}${change.worktree} ${change.path}`);
    }
  }
  lines.push("diffStat:");
  for (const stat of evidence.git.diffStat.slice(0, 50)) {
    lines.push(`- ${stat.path} (+${stat.added}/-${stat.deleted}${stat.untracked ? " untracked" : ""})`);
  }
  lines.push("worktrees:");
  for (const worktree of evidence.git.worktrees) {
    lines.push(`- ${worktree.path} (${worktree.branch ?? "detached"} @ ${worktree.head.slice(0, 10)})`);
  }
  lines.push("");

  lines.push("## Recent commits", "");
  lines.push("_Commit subjects are change descriptions; by themselves they do not prove feature or business completion._");
  for (const commit of commits) {
    lines.push(`- ${commit.hash.slice(0, 10)} ${commit.authoredAt} ${truncate(commit.subject)}`);
  }
  lines.push("");

  lines.push("## Sessions (metadata)", "");
  for (const session of metadataSessions) {
    lines.push(
      `- ${session.sessionId} "${session.name ?? "unnamed"}" updated ${session.updatedAt}` +
        `${session.parentSession ? ` (fork of ${session.parentSession})` : ""}` +
        `: ${session.userRequests.length} user requests, ${session.conclusions.length} conclusions`,
    );
  }
  lines.push("");

  lines.push("## Sessions (detail: active branch)", "");
  for (const session of detailedSessions) {
    lines.push(`### ${session.sessionId}`, "");
    for (const request of session.userRequests) {
      lines.push(`- user (${request.entryId}): ${truncate(request.text)}`);
    }
    for (const conclusion of session.conclusions) {
      if (emittedConclusionTexts.has(conclusion.text) && session.parentSession) continue;
      lines.push(`- assistant (${conclusion.entryId}): ${truncate(conclusion.text)}`);
    }
    for (const claim of session.verificationClaims) {
      lines.push(`- claimed verification (${claim.entryId}): ${claim.command ?? ""} → ${truncate(claim.claimedResult)}`);
    }
    lines.push("");
  }

  let content = lines.join("\n");

  if (content.length > limits.maxTotalChars) {
    // First retain the freshest users' requests while dropping lower-priority
    // assistant conclusions and claimed verification detail.
    const detailedIndex = content.indexOf("## Sessions (detail: active branch)");
    if (detailedIndex !== -1) {
      const requestOnly: string[] = ["## Sessions (detail: user requests only)", ""];
      for (const session of detailedSessions) {
        requestOnly.push(`### ${session.sessionId}`, "");
        for (const request of session.userRequests) {
          requestOnly.push(`- user (${request.entryId}): ${truncate(request.text)}`);
        }
        requestOnly.push("");
      }
      content = content.slice(0, detailedIndex) + requestOnly.join("\n");
      truncations.push("assistant conclusions and claimed verification omitted before user requests");
    }
  }
  if (content.length > limits.maxTotalChars) {
    const detailedIndex = content.indexOf("## Sessions (detail: user requests only)");
    if (detailedIndex !== -1) {
      content =
        content.slice(0, detailedIndex) +
        "## Sessions (detail: active branch)\n\n_(dropped to fit bundle budget; explicit corrections kept above)_\n";
      truncations.push("session details dropped to fit bundle budget (explicit corrections, metadata and conflicts kept)");
    }
  }
  if (content.length > limits.maxTotalChars) {
    content = content.slice(0, limits.maxTotalChars);
    truncations.push("hard truncation at bundle budget — conflicts section kept by construction order");
  }

  return {
    content,
    estimatedTokens: Math.ceil(content.length / 4),
    truncations,
  };
}
