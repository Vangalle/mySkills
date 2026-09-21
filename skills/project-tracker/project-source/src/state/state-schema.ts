/**
 * State schema helpers: validation of proposals against collected evidence.
 * The Zod schemas themselves live in src/contracts.ts (single contract source).
 */
import { verificationEvidenceId, isCurrentPassingVerification } from "../verification/index.js";
import { CONSTRAINT_PATHS, GOAL_ORIGIN_PATHS } from "../goals/document-source.js";
import {
  createProjectStateProposalSchema,
  ProjectStateProposalSchema,
  StateProposalSchema,
  type ProjectStateProposal,
  type VerificationRecord,
} from "../contracts.js";

export interface ProposalValidation {
  ok: boolean;
  errors: string[];
}

export interface ProposalEvidenceContext {
  verification?: VerificationRecord[];
  references: Array<{
    id: string;
    source?: string;
    confidence?: string;
    locator?: string;
    summary?: string;
    observedAt?: string;
  }>;
  boundaries?: Array<{
    id: string;
    statement: string;
  }>;
}

function normalizedStatement(statement: string): string {
  return statement.trim().replace(/\s+/g, " ");
}

/** Validate structure, evidence ids, maturity support, and current boundaries. */
export function validateProposalAgainstEvidence(
  proposal: unknown,
  evidence: ProposalEvidenceContext,
): ProposalValidation {
  const knownIds = evidence.references.map((reference) => reference.id);
  const contextual = createProjectStateProposalSchema(knownIds).safeParse(proposal);
  const errors = contextual.success
    ? []
    : contextual.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  // Context checks need a structurally valid proposal even when the contextual
  // schema has already found unknown evidence ids.
  const structural = StateProposalSchema.safeParse(proposal);
  if (structural.success) {
    const parsed = structural.data;
    const refsById = new Map(evidence.references.map((reference) => [reference.id, reference]));

    if (parsed.schemaVersion === 2 && parsed.projectGoal) {
      for (const [index, origin] of parsed.projectGoal.origins.entries()) {
        if (CONSTRAINT_PATHS.includes(origin.path)) {
          errors.push(`projectGoal.origins.${index}: ${origin.path} 是约束文档，不能用来推导项目目标；目标只能来自 ${GOAL_ORIGIN_PATHS.join(" / ")}。`);
          continue;
        }
        if (!GOAL_ORIGIN_PATHS.includes(origin.path)) {
          errors.push(`projectGoal.origins.${index}: ${origin.path} 不是目标来源文档`);
          continue;
        }
        const ref = refsById.get(origin.evidenceId);
        if (ref?.source !== "filesystem" || ref.confidence !== "observed" || ref.locator !== origin.path) {
          errors.push(`projectGoal.origins.${index}: 找不到对应 ${origin.path} 的当前观察证据，请重新扫描后再提交`);
        }
      }
    }

    for (const [index, workstream] of (parsed.schemaVersion === 1 ? parsed.workstreams : []).entries()) {
      if (workstream.status !== "STABLE" || workstream.evidenceIds.length === 0) continue;
      const supportingRefs = workstream.evidenceIds
        .map((id) => refsById.get(id))
        .filter((reference) => reference !== undefined);
      const commitOnly =
        supportingRefs.length === workstream.evidenceIds.length &&
        supportingRefs.every(
          (reference) => reference.source === "git" && reference.id.startsWith("git:commit:"),
        );
      if (commitOnly) {
        errors.push(
          `workstreams.${index}.evidenceIds: commit-only evidence cannot support STABLE; add current verification or lower the status`,
        );
      }
      const citesVerification = supportingRefs.some(
        (reference) =>
          reference.source === "verification" && reference.id.startsWith("verify:"),
      );
      const hasCurrentPassingVerification = (evidence.verification ?? []).some(
        (record, verificationIndex) =>
          workstream.evidenceIds.includes(verificationEvidenceId(record, verificationIndex)) &&
          isCurrentPassingVerification(record),
      );
      if (citesVerification && !hasCurrentPassingVerification) {
        errors.push(
          `workstreams.${index}.evidenceIds: stale or unbound verification cannot support STABLE; add current passing verification or lower the status`,
        );
      }
    }

    for (const [g, goal] of (parsed.goals ?? []).entries()) {
      for (const [d, design] of goal.designs.entries()) {
        for (const [a, item] of design.acceptance.entries()) {
          if (item.complete && !acceptanceHasCurrentEvidence(item.evidenceIds, evidence)) {
            errors.push(`goals.${g}.designs.${d}.acceptance.${a}: completed acceptance requires current passing verification evidence`);
          }
        }
      }
    }

    for (const boundary of evidence.boundaries ?? []) {
      const recorded = parsed.boundaries.find((entry) => entry.evidenceIds.includes(boundary.id));
      if (!recorded) {
        errors.push(`boundaries: missing project boundary ${boundary.id}: ${boundary.statement}`);
        continue;
      }
      if (normalizedStatement(recorded.statement) !== normalizedStatement(boundary.statement)) {
        errors.push(`boundaries: project boundary ${boundary.id} must be copied without changing its meaning`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Type-guard: is the parsed object a valid proposal? */
export function isValidProposal(proposal: unknown): proposal is ProjectStateProposal {
  return (
    proposal !== null &&
    typeof proposal === "object" &&
    (proposal as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (proposal as { executiveSummary?: unknown }).executiveSummary === "string"
  );
}

/** Only a collected, current PASS can support acceptance; a session claim cannot. */
export function acceptanceHasCurrentEvidence(ids: string[], evidence: ProposalEvidenceContext): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => {
    const reference = evidence.references.find((entry) => entry.id === id);
    if (reference?.source !== "verification" || reference.confidence !== "observed") return false;
    return (evidence.verification ?? []).some((record, index) =>
      verificationEvidenceId(record, index) === id && isCurrentPassingVerification(record),
    );
  });
}
