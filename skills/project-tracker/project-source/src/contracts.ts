/**
 * Canonical contracts for project-tracker.
 *
 * All cross-module data shapes live here. Zod schemas are the runtime
 * authority; the exported TS types are inferred from them. Evidence IDs are
 * short stable strings, never file contents or secrets.
 */
import { z } from "zod";
import { isAbsolute } from "node:path";
import { GoalSourceSchema } from "./goals/types.js";
import { FeatureGoalsSchema, ProjectObjectiveSchema } from "./state/design-history.js";

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const EvidenceConfidenceSchema = z.enum(["normative", "observed", "reported", "inferred"]);
export type EvidenceConfidence = z.infer<typeof EvidenceConfidenceSchema>;

export const EvidenceSourceSchema = z.enum([
  "git",
  "pi_session",
  "project_state",
  "project_boundary",
  "verification",
  "filesystem",
]);

export const ClaimMaturitySchema = z.enum([
  "CODE_EXISTS",
  "DEMO_VERIFIED",
  "LOCAL_PROTOTYPE_VERIFIED",
  "PRODUCTION_VERIFIED",
]);
export type ClaimMaturity = z.infer<typeof ClaimMaturitySchema>;

export const ProjectStatusSchema = z.enum(["STABLE", "ACTIVE", "BLOCKED", "PLANNED", "DEFERRED"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ReleaseStateSchema = z.enum(["STABLE", "ACTIVE", "BLOCKED"]);
export type ReleaseState = z.infer<typeof ReleaseStateSchema>;

export const SeveritySchema = z.enum(["P0", "P1", "P2"]);
export type Severity = z.infer<typeof SeveritySchema>;

const IsoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

// ---------------------------------------------------------------------------
// Evidence references (provenance pointers only — never raw sensitive content)
// ---------------------------------------------------------------------------

export const EvidenceRefSchema = z.object({
  id: z.string().min(1),
  source: EvidenceSourceSchema,
  confidence: EvidenceConfidenceSchema,
  observedAt: IsoDateSchema,
  /** Traceable location: commit hash, repo-relative path, session id + entry id. */
  locator: z.string(),
  summary: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// ---------------------------------------------------------------------------
// Git evidence (section 2.2) — plumbing/porcelain output only
// ---------------------------------------------------------------------------

export const GitEvidenceSchema = z.object({
  branch: z.string().nullable(),
  head: z.string().min(1),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  changed: z.array(
    z.object({
      path: z.string(),
      index: z.string(),
      worktree: z.string(),
    }),
  ),
  recentCommits: z.array(
    z.object({
      hash: z.string(),
      authoredAt: z.string(),
      subject: z.string(),
    }),
  ),
  worktrees: z.array(
    z.object({
      path: z.string(),
      head: z.string(),
      branch: z.string().nullable(),
    }),
  ),
  diffStat: z.array(
    z.object({
      path: z.string(),
      added: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
      untracked: z.boolean(),
    }),
  ),
});
export type GitEvidence = z.infer<typeof GitEvidenceSchema>;

// ---------------------------------------------------------------------------
// Pi session evidence (section 2.3)
// ---------------------------------------------------------------------------

export const PiSessionEvidenceSchema = z.object({
  sessionId: z.string(),
  file: z.string(),
  cwd: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  name: z.string().optional(),
  activeLeafId: z.string().optional(),
  userRequests: z.array(
    z.object({
      entryId: z.string(),
      text: z.string(),
    }),
  ),
  assistantConclusions: z.array(
    z.object({
      entryId: z.string(),
      text: z.string(),
      stopReason: z.string().optional(),
    }),
  ),
  compactions: z.array(
    z.object({
      entryId: z.string(),
      summary: z.string(),
    }),
  ),
  fileOperations: z.array(
    z.object({
      entryId: z.string(),
      operation: z.enum(["read", "write", "edit"]),
      path: z.string(),
    }),
  ),
  verificationClaims: z.array(
    z.object({
      entryId: z.string(),
      command: z.string().optional(),
      claimedResult: z.string(),
      confidence: z.literal("reported"),
    }),
  ),
  parseWarnings: z.array(z.string()),
});
export type PiSessionEvidence = z.infer<typeof PiSessionEvidenceSchema>;

// ---------------------------------------------------------------------------
// Verification records
// ---------------------------------------------------------------------------

export const VerificationRecordSchema = z.object({
  /** Stable evidence identity for durable runs; absent on legacy records. */
  id: z.string().regex(/^verify:/).optional(),
  command: z.string().min(1),
  result: z.enum(["PASS", "FAIL", "ERROR"]),
  exitCode: z.number().int().nullable(),
  verifiedAt: IsoDateSchema,
  outputSummary: z.string(),
  /** Code/worktree snapshot against which this command actually ran. */
  binding: z
    .object({
      projectRoot: z.string().min(1),
      head: z.string().min(1),
      contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      /** False when HEAD or worktree content changed before the run completed. */
      stable: z.boolean(),
    })
    .optional(),
  /** Derived at scan time and never trusted from the durable store. */
  freshness: z.enum(["current", "stale", "unbound"]).optional(),
});
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>;

// ---------------------------------------------------------------------------
// Explicit project boundaries (opt-in markers in AGENTS.md)
// ---------------------------------------------------------------------------

export const ProjectBoundarySchema = z.object({
  id: z.string().regex(/^boundary:/),
  statement: z.string().min(1),
  sourcePath: z.string().min(1),
  line: z.number().int().positive(),
});
export type ProjectBoundary = z.infer<typeof ProjectBoundarySchema>;

// ---------------------------------------------------------------------------
// Conflicts (section 3.4)
// ---------------------------------------------------------------------------

export const EvidenceConflictSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "stale_verification_claim",
    "baseline_drift",
    "dirty_baseline",
    "stale_release_state",
    "project_boundary_drift",
  ]),
  severity: SeveritySchema,
  description: z.string().min(1),
  claimedEvidenceId: z.string(),
  observedEvidenceId: z.string(),
});
export type EvidenceConflict = z.infer<typeof EvidenceConflictSchema>;

// ---------------------------------------------------------------------------
// State proposal (section 2.4)
// ---------------------------------------------------------------------------

const StateReferenceSchema = z.object({
  label: z.string().min(1),
  path: z
    .string()
    .refine((p) => !isAbsolute(p) && !p.split(/[\\/]/).includes(".."), {
      message: "reference paths must be repo-relative",
    }),
});

/** Goal associations are explicit pointers to upstream documents, not a second spec lifecycle. */
const GoalPathSchema = z.string().min(1).refine(
  (p) => !isAbsolute(p) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p) && !p.includes("\\") && !p.split("/").includes(".."),
  { message: "goal source paths must be repo-relative" },
);
const AcceptanceSchema = z.object({
  id: z.string().min(1), criterion: z.string().min(1), complete: z.boolean(),
  evidenceIds: z.array(z.string().min(1)),
}).superRefine((item, ctx) => {
  if (item.complete && item.evidenceIds.length === 0) ctx.addIssue({
    code: z.ZodIssueCode.custom, path: ["evidenceIds"], message: "completed acceptance requires evidence",
  });
});
export const ProjectGoalSchema = z.object({
  id: z.string().min(1), title: z.string().min(1),
  designs: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1), path: GoalPathSchema,
    taskPaths: z.array(GoalPathSchema).optional(), acceptance: z.array(AcceptanceSchema),
  })),
});
export type ProjectGoal = z.infer<typeof ProjectGoalSchema>;

const WorkstreamSchema = z
  .object({
    name: z.string().min(1),
    status: ProjectStatusSchema,
    claimMaturity: ClaimMaturitySchema,
    stableBaseline: z.string(),
    currentGap: z.string(),
    evidenceIds: z.array(z.string().min(1)),
  })
  .superRefine((ws, ctx) => {
    if (ws.status === "STABLE" && ws.evidenceIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceIds"],
        message: "STABLE workstream requires at least one evidence reference",
      });
    }
  });

const ActiveWorkItemSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["ACTIVE", "BLOCKED"]),
  completed: z.array(z.string().min(1)),
  remaining: z.array(z.string().min(1)),
  definitionOfDone: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)),
});

const RiskSchema = z.object({
  severity: SeveritySchema,
  problem: z.string().min(1),
  impact: z.string().min(1),
  nextAction: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
});

const StateBoundarySchema = z.object({
  statement: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const ProjectStateProposalSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    baseline: z.object({
      branch: z.string().nullable(),
      commit: z.string().min(4),
      verifiedAt: IsoDateSchema,
    }),
    releaseState: ReleaseStateSchema,
    executiveSummary: z.string().min(1),
    currentMilestone: z.object({
      objective: z.string().min(1),
      exitCriteria: z
        .array(z.string().min(1))
        .min(1, { message: "current milestone must define at least one exit criterion" }),
    }),
    workstreams: z.array(WorkstreamSchema),
    activeWork: z.array(ActiveWorkItemSchema),
    risks: z.array(RiskSchema),
    verification: z.array(VerificationRecordSchema),
    nextActions: z
      .array(z.object({ priority: SeveritySchema, action: z.string().min(1) }))
      .max(10, { message: "at most 10 next actions are allowed" }),
    boundaries: z.array(StateBoundarySchema),
    references: z.array(StateReferenceSchema),
    goals: z.array(ProjectGoalSchema).optional(),
  })
  .superRefine((proposal, ctx) => {
    const activeCount = proposal.activeWork.filter((w) => w.status === "ACTIVE").length;
    if (activeCount > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeWork"],
        message: "at most 3 ACTIVE work items are allowed",
      });
    }
  });
export type ProjectStateProposal = z.infer<typeof ProjectStateProposalSchema>;

export const DesignStateProposalSchema = ProjectStateProposalSchema.innerType().pick({
  baseline: true, releaseState: true, boundaries: true, verification: true, references: true,
}).extend({
  schemaVersion: z.literal(2), projectGoal: ProjectObjectiveSchema, goals: FeatureGoalsSchema,
  legacyStatus: ProjectStateProposalSchema.innerType().pick({
    executiveSummary: true, currentMilestone: true, workstreams: true,
    activeWork: true, risks: true, nextActions: true,
  }).optional(),
}).strict();
export type DesignStateProposal = z.infer<typeof DesignStateProposalSchema>;
export const StateProposalSchema = z.union([ProjectStateProposalSchema, DesignStateProposalSchema]);
export type StateProposal = z.infer<typeof StateProposalSchema>;

/**
 * Context-aware proposal schema: also rejects evidence IDs that do not exist in
 * the evidence bundle the proposal is being validated against.
 */
export function createProjectStateProposalSchema(
  knownEvidenceIds: Iterable<string>,
): z.ZodType<StateProposal> {
  const known = new Set(knownEvidenceIds);
  return StateProposalSchema.superRefine((proposal, ctx) => {
    const checkIds = (ids: readonly string[], path: (string | number)[]) => {
      for (const id of ids) {
        if (!known.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: `unknown evidence id: ${id}`,
          });
        }
      }
    };
    const legacy = proposal.schemaVersion === 1 ? proposal : undefined;
    for (const [i, ws] of (legacy?.workstreams ?? []).entries()) {
      checkIds(ws.evidenceIds, ["workstreams", i, "evidenceIds"]);
    }
    for (const [i, w] of (legacy?.activeWork ?? []).entries()) {
      checkIds(w.evidenceIds, ["activeWork", i, "evidenceIds"]);
    }
    for (const [i, r] of (legacy?.risks ?? []).entries()) {
      checkIds(r.evidenceIds, ["risks", i, "evidenceIds"]);
    }
    for (const [g, goal] of (proposal.goals ?? []).entries()) {
      for (const [d, design] of goal.designs.entries()) {
        for (const [a, item] of design.acceptance.entries()) {
          checkIds(item.evidenceIds, ["goals", g, "designs", d, "acceptance", a, "evidenceIds"]);
        }
      }
    }
    for (const [i, boundary] of proposal.boundaries.entries()) {
      checkIds(boundary.evidenceIds, ["boundaries", i, "evidenceIds"]);
    }
  });
}

// ---------------------------------------------------------------------------
// Parsed PROJECT_STATE.md
// ---------------------------------------------------------------------------

export const ParsedProjectStateSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  lastVerified: IsoDateSchema.nullable(),
  baseline: z
    .object({ branch: z.string().nullable(), commit: z.string(), verifiedAt: IsoDateSchema })
    .nullable(),
  releaseState: ReleaseStateSchema.nullable(),
  proposal: StateProposalSchema.nullable(),
  /** Unknown human-authored sections preserved verbatim on round-trip. */
  unknownSections: z.array(z.object({
    title: z.string(), body: z.string(),
    // v1 parser provenance only; distinguishes container children from standalone sections.
    legacyNoteKind: z.enum(["intro", "child"]).optional(),
  })),
});
export type ParsedProjectState = z.infer<typeof ParsedProjectStateSchema>;

// ---------------------------------------------------------------------------
// Full evidence bundle
// ---------------------------------------------------------------------------

export const CollectionIssueSchema = z.object({
  source: z.enum(["git", "pi_session", "project_state", "project_boundary", "verification", "configuration", "document"]),
  code: z.string().min(1),
  message: z.string().min(1),
});
export type CollectionIssue = z.infer<typeof CollectionIssueSchema>;
export const CollectionReportSchema = z.object({
  complete: z.boolean(),
  issues: z.array(CollectionIssueSchema),
}).refine((value) => value.complete === (value.issues.length === 0), {
  message: "collection completeness must agree with its issues",
});

export const ProjectEvidenceSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  collectedAt: IsoDateSchema,
  /** Missing on legacy evidence; absence never proves a complete scan. */
  collection: CollectionReportSchema.optional(),
  project: z.object({
    name: z.string().min(1),
    root: z.string(),
    worktrees: z.array(z.string()),
  }),
  git: GitEvidenceSchema,
  sessions: z.array(PiSessionEvidenceSchema),
  boundaries: z.array(ProjectBoundarySchema),
  existingState: ParsedProjectStateSchema.nullable().optional(),
  documents: z.array(GoalSourceSchema).optional(),
  references: z.array(EvidenceRefSchema),
  conflicts: z.array(EvidenceConflictSchema),
  verification: z.array(VerificationRecordSchema),
});
export type ProjectEvidence = z.infer<typeof ProjectEvidenceSchema>;

// ---------------------------------------------------------------------------
// Project scope (output of discovery)
// ---------------------------------------------------------------------------

export interface ProjectScope {
  name: string;
  /** Canonical realpath of the main git root. */
  root: string;
  worktrees: string[];
  /** Extra paths the user explicitly registered (canonical realpaths). */
  extraPaths: string[];
  isGit: boolean;
  isBare: boolean;
}
