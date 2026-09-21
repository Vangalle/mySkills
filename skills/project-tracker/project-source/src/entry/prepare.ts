import { z } from "zod";
import { ProjectEvidenceSchema, type ProjectScope, type CollectionIssue } from "../contracts.js";
import { buildProjectEvidence, type BuildEvidenceOptions } from "../analysis/evidence-builder.js";
import { buildBoundedBundle } from "../analysis/bounded-bundle.js";
import { inspectState } from "../state/onboarding.js";

/** Receipt of this invocation, not a durable project-completion claim. */
export const PreparedProjectContextSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  status: z.literal("ready"),
  project: ProjectEvidenceSchema.shape.project,
  collectedAt: z.string().datetime({ offset: true }),
  bundle: z.object({
    content: z.string().min(1),
    estimatedTokens: z.number().int().nonnegative(),
    truncations: z.array(z.string()),
  }),
});
export type PreparedProjectContext = z.infer<typeof PreparedProjectContextSchema>;
export const OnboardingProjectContextSchema = PreparedProjectContextSchema.extend({
  status: z.literal("needs_state_setup"),
  state: z.object({ path: z.string(), expectedHash: z.string().nullable(), status: z.enum(["legacy", "incompatible"]), backupName: z.literal("bak/PROJECT_STATE.md"), requiresReview: z.literal(true) }),
});
export const EntryProjectContextSchema = z.union([PreparedProjectContextSchema, OnboardingProjectContextSchema]);

export class IncompleteScanError extends Error {
  constructor(readonly issues: CollectionIssue[]) {
    super("项目还没扫描完整，暂时不能继续。请检查以下读取问题后重试。");
    this.name = "IncompleteScanError";
  }
}

export async function prepareProjectContext(
  scope: ProjectScope,
  options: BuildEvidenceOptions & { requestId: string; onboarding?: boolean },
): Promise<z.infer<typeof EntryProjectContextSchema>> {
  const collected = await buildProjectEvidence(scope, options);
  // Check before validating partial evidence (e.g. a failed Git HEAD read).
  const issues = collected.collection?.issues ?? [];
  const setupOnly = options.onboarding && issues.length > 0 && issues.every(i => i.code === "state_invalid" && i.source === "project_state");
  if (collected.collection?.complete !== true && !setupOnly) throw new IncompleteScanError(issues);
  const evidence = ProjectEvidenceSchema.parse(collected);
  if (options.onboarding) {
    const state = await inspectState(scope.root, options.config.stateFileName);
    if (state.requiresReview) return OnboardingProjectContextSchema.parse({
      schemaVersion: 1, requestId: options.requestId, status: "needs_state_setup", project: evidence.project,
      collectedAt: evidence.collectedAt, state, bundle: buildBoundedBundle(evidence, options.config.bundleLimits),
    });
    if (setupOnly) throw new IncompleteScanError(issues);
  }
  return PreparedProjectContextSchema.parse({
    schemaVersion: 1,
    requestId: options.requestId,
    status: "ready",
    project: evidence.project,
    collectedAt: evidence.collectedAt,
    bundle: buildBoundedBundle(evidence, options.config.bundleLimits),
  });
}
