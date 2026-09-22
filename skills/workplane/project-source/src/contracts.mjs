/**
 * Workplane contracts.
 *
 * Two halves meet here:
 *   authored  — `WORKPLANE.json`: which Work Units exist, how they are grouped,
 *               what each one promises, and which Tracker Designs affect it.
 *   provided  — a Tracker-owned snapshot of Goals, Designs, progress and
 *               verification evidence, delivered inside a versioned request.
 *
 * Workplane never re-declares Project Goal, Feature Goal, Design progress,
 * Design acceptance or verification history. Unknown fields are rejected so
 * copied Tracker data cannot silently ride along.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = "workplane.plugin/v1";
export const WORKPLANE_API_VERSION = "workplane/v1";

export const InspectReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().uuid(),
    status: z.enum(["missing", "ready", "needs_repair"]),
    project: z.object({ root: z.string().min(1), name: z.string().min(1) }).strict(),
    definition: z
      .object({
        path: z.string().min(1),
        exists: z.boolean(),
        sha256: z.string().length(64).regex(/^[a-f0-9]+$/).nullable(),
      })
      .strict(),
    preparedAt: z.string().datetime(),
    diagnostics: z
      .array(z.object({ path: z.string(), message: z.string().max(500) }).strict())
      .max(20),
  })
  .strict();

export const OPERATIONS = ["inspect", "change", "verify", "record"];
/** capability = user-visible feature · interface = contract/entry · support = infrastructure */
export const UNIT_KINDS = ["capability", "interface", "support"];

const WorkplaneIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, "ids are lower-kebab");
const TrackerHistoryIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "invalid Tracker history id");

/** Anchors are repository-relative paths; the builder never touches the disk. */
const AnchorPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
    { message: "anchor must be a repository-relative path" },
  );

const CheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test"), ref: z.string().min(1), command: z.string().min(1).default("npm test") }).strict(),
  z.object({ kind: z.literal("verification"), ref: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("manual"), ref: z.string().optional(), note: z.string().optional() }).strict(),
]);

const AcceptanceSchema = z
  .object({
    id: WorkplaneIdSchema,
    criterion: z.string().min(1),
    check: CheckSchema,
  })
  .strict();

const GroupSchema = z
  .object({
    id: WorkplaneIdSchema,
    title: z.string().min(1),
    parent: WorkplaneIdSchema.optional(),
  })
  .strict();

export const WorkUnitSchema = z
  .object({
    id: WorkplaneIdSchema,
    title: z.string().min(1),
    kind: z.enum(UNIT_KINDS),
    function: z
      .object({
        does: z.string().min(1),
        inScope: z.array(z.string()).default([]),
        outOfScope: z.array(z.string()).default([]),
      })
      .strict(),
    contract: z
      .object({
        provides: z.array(z.string()).default([]),
        consumes: z.array(z.string()).default([]),
      })
      .strict()
      .default({ provides: [], consumes: [] }),
    acceptance: z.array(AcceptanceSchema).default([]),
    anchors: z
      .object({
        code: z.array(AnchorPathSchema).default([]),
        docs: z.array(AnchorPathSchema).default([]),
        map: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ code: [], docs: [], map: [] }),
    /** Containment is `parent`; dependencies are the only edge relation. */
    edges: z
      .object({
        dependsOn: z.array(WorkplaneIdSchema).default([]),
      })
      .strict()
      .default({ dependsOn: [] }),
    operations: z.array(z.enum(OPERATIONS)).default([]),
    /** Containment parent: a group id, another unit id, or the project root. */
    parent: WorkplaneIdSchema.optional(),
    blocked: z.object({ reason: z.string().min(1) }).strict().optional(),
  })
  .strict();

export const WorkplaneDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(GroupSchema).default([]),
    units: z.array(WorkUnitSchema).min(1),
    designImpacts: z
      .array(
        z
          .object({
            goalId: TrackerHistoryIdSchema,
            designId: TrackerHistoryIdSchema,
            unitIds: z.array(WorkplaneIdSchema).min(1),
          })
          .strict(),
      )
      .default([]),
    glossary: z
      .array(
        z
          .object({
            term: z.string().min(1),
            plain: z.string().min(1),
            detail: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const ProgressSnapshotSchema = z
  .object({
    id: z.string().min(1),
    recordedAt: z.string().min(1),
    text: z.string().min(1),
    evidenceIds: z.array(z.string()).default([]),
    gitRefs: z.array(z.string()).default([]),
  })
  .strict();

const DesignAcceptanceSnapshotSchema = z
  .object({
    id: z.string().min(1),
    criterion: z.string().min(1),
    complete: z.boolean(),
    evidenceIds: z.array(z.string()).default([]),
  })
  .strict();

const DesignSnapshotSchema = z
  .object({
    id: TrackerHistoryIdSchema,
    title: z.string().min(1),
    path: z.string().min(1),
    /** Logical parents inside the same Feature Goal; `null` means "no parent declared". */
    parents: z.array(TrackerHistoryIdSchema).nullable().default(null),
    progress: z.array(ProgressSnapshotSchema).default([]),
    acceptance: z.array(DesignAcceptanceSnapshotSchema).default([]),
  })
  .strict();

const FeatureGoalSnapshotSchema = z
  .object({
    id: TrackerHistoryIdSchema,
    title: z.string().min(1),
    designs: z.array(DesignSnapshotSchema).default([]),
  })
  .strict();

const VerificationRecordSchema = z
  .object({
    id: z.string().min(1).optional(),
    command: z.string().min(1),
    result: z.enum(["PASS", "FAIL", "ERROR"]),
    verifiedAt: z.string().min(1),
    freshness: z.enum(["current", "stale", "unbound"]),
  })
  .strict();

export const TrackerSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: z.object({ name: z.string().min(1), root: z.string().min(1) }).strict(),
    projectGoal: z.object({ statement: z.string().min(1) }).strict().nullable(),
    goals: z.array(FeatureGoalSnapshotSchema).default([]),
    git: z.object({ head: z.string().min(1) }).strict(),
    verification: z.array(VerificationRecordSchema).default([]),
  })
  .strict();

export const PluginRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    definition: WorkplaneDefinitionSchema,
    tracker: TrackerSnapshotSchema,
  })
  .strict();

const PlaneProjectSchema = z
  .object({
    name: z.string().min(1),
    root: z.string().min(1),
    goalStatement: z.string().min(1).nullable(),
  })
  .strict();

const HierarchyNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(["goal", "group", "unit"]),
    parent: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    ancestors: z.array(z.string()),
    children: z.array(z.string()),
  })
  .passthrough();

const ResolvedCheckSchema = z
  .object({
    status: z.enum(["pass", "stale", "missing", "fail", "unknown", "present"]),
    freshness: z.string().nullable(),
    command: z.string().optional(),
    evidenceId: z.string().nullable().optional(),
    verifiedAt: z.string().optional(),
  })
  .passthrough();

const PlaneUnitSchema = z
  .object({
    id: WorkplaneIdSchema,
    title: z.string().min(1),
    kind: z.enum(UNIT_KINDS),
    status: z.enum(["verified", "partial", "stale", "pending", "blocked"]),
    progress: z.object({ satisfied: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).passthrough(),
    acceptance: z.array(z.object({ resolved: ResolvedCheckSchema }).passthrough()),
    designs: z.array(z.object({ goalId: z.string(), designId: z.string(), title: z.string() }).passthrough()),
  })
  .passthrough();

export const PlaneDocumentSchema = z
  .object({
    apiVersion: z.literal(WORKPLANE_API_VERSION),
    generatedAt: z.string().min(1),
    project: PlaneProjectSchema,
    glossary: z.array(z.any()).default([]),
    hierarchy: z
      .object({
        rootId: z.string().min(1),
        nodes: z.array(HierarchyNodeSchema),
      })
      .passthrough(),
    goals: z.array(z.any()),
    designImpacts: z.array(z.any()),
    units: z.array(PlaneUnitSchema),
    coverage: z.any(),
    receipt: z
      .object({
        profile: z.string(),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
        pass: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

const PluginErrorSchema = z.object({ path: z.string(), message: z.string().min(1) }).strict();

export const PluginResponseSchema = z.union([
  z
    .object({
      protocolVersion: z.literal(PROTOCOL_VERSION),
      status: z.literal("ok"),
      document: PlaneDocumentSchema,
      html: z.string().min(1),
      mermaid: z.string().min(1),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(PROTOCOL_VERSION),
      status: z.literal("invalid"),
      errors: z.array(PluginErrorSchema).min(1),
    })
    .strict(),
]);
