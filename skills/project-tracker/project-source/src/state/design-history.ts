/** Logical ancestry is explicit design data, never inferred from Git. */
import { z } from "zod";
import { isAbsolute } from "node:path";

export const HistoryIdSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const DocumentPathSchema = z.string().min(1).refine(path =>
  !isAbsolute(path) && !/^[\w+.-]+:/.test(path) && !/[\\\0]/.test(path) && !path.split("/").includes(".."),
{ message: "source must be a repo-relative path" });
export const ProgressRecordSchema = z.object({
  id: HistoryIdSchema, recordedAt: z.string().datetime({ offset: true }),
  text: z.string().min(1).max(16000), evidenceIds: z.array(z.string().min(1)),
  gitRefs: z.array(z.string().regex(/^[a-f0-9]{4,64}$/i)),
}).strict();
export type ProgressRecord = z.infer<typeof ProgressRecordSchema>;
const AcceptanceSchema = z.object({
  id: HistoryIdSchema, criterion: z.string().min(1), complete: z.boolean(), evidenceIds: z.array(z.string().min(1)),
}).strict().refine(item => !item.complete || item.evidenceIds.length > 0, "completed acceptance requires evidence");
export const DesignNodeSchema = z.object({
  id: HistoryIdSchema, title: z.string().min(1), path: DocumentPathSchema,
  taskPaths: z.array(DocumentPathSchema).optional(), parents: z.array(HistoryIdSchema).nullable(),
  acceptance: z.array(AcceptanceSchema), progress: z.array(ProgressRecordSchema),
}).strict();
export type DesignNode = z.infer<typeof DesignNodeSchema>;
export const FeatureGoalSchema = z.object({
  id: HistoryIdSchema, title: z.string().min(1), designs: z.array(DesignNodeSchema),
}).strict();
export type FeatureGoal = z.infer<typeof FeatureGoalSchema>;
const OriginSchema = z.object({ path: DocumentPathSchema, evidenceId: z.string().startsWith("document:") }).strict();
export const ProjectObjectiveSchema = z.object({
  statement: z.string().min(1), philosophy: OriginSchema, market: OriginSchema, reasoning: z.string().min(1),
}).strict().nullable();

export const FeatureGoalsSchema = z.array(FeatureGoalSchema).superRefine((goals, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) issue(`duplicate ${label}`); };
  unique(goals.map(g => g.id), "goal ID");
  for (const goal of goals) {
    unique(goal.designs.map(d => d.id), "design ID");
    const nodes = new Map(goal.designs.map(d => [d.id, d]));
    let valid = true;
    for (const node of goal.designs) {
      unique(node.progress.map(r => r.id), "progress ID");
      unique(node.acceptance.map(a => a.id), "acceptance ID");
      unique(node.parents ?? [], "parent ID");
      for (const parent of node.parents ?? []) if (!nodes.has(parent) || parent === node.id) {
        issue(`invalid parent ${parent} for ${node.id}`); valid = false;
      }
    }
    if (!valid) continue;
    // Iterative topological traversal avoids stack overflow on a long history.
    const indegree = new Map(goal.designs.map(d => [d.id, d.parents?.length ?? 0]));
    const children = new Map<string, string[]>();
    for (const node of goal.designs) for (const parent of node.parents ?? []) {
      children.set(parent, [...(children.get(parent) ?? []), node.id]);
    }
    const ready = [...indegree.keys()].filter(id => indegree.get(id) === 0);
    let count = 0;
    for (let i = 0; i < ready.length; i++) {
      count++;
      for (const child of children.get(ready[i]!) ?? []) {
        const n = indegree.get(child)! - 1; indegree.set(child, n);
        if (n === 0) ready.push(child);
      }
    }
    if (count !== nodes.size) issue("design ancestry cycle");
  }
});
