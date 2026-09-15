import type { ProjectGoal, DesignStateProposal, VerificationRecord } from "../contracts.js";
import type { ProgressRecord } from "../state/design-history.js";
import { z } from "zod";

export const GoalSourceSchema = z.object({
  path: z.string(), kind: z.enum(["openspec", "spec-kit", "project"]),
  status: z.enum(["available", "missing", "unavailable"]),
  title: z.string(), preview: z.string(), truncated: z.boolean(),
  tasks: z.array(z.object({ text: z.string(), checked: z.boolean() })),
  evidenceId: z.string().optional(),
});
export type GoalSource = z.infer<typeof GoalSourceSchema>;
export interface GoalOverview {
  projectGoal?: DesignStateProposal["projectGoal"];
  goalOriginCurrent?: boolean;
  goals: Array<Omit<ProjectGoal, "designs"> & { designs: Array<Omit<ProjectGoal["designs"][number], "acceptance"> & {
    parents?: string[] | null;
    progress?: Array<ProgressRecord & { verification?: Array<VerificationRecord & { current: boolean }> }>;
    source: GoalSource;
    taskSources: GoalSource[];
    taskProgress: { completed: number; total: number };
    mark: { completed: number; total: number };
    acceptance: Array<ProjectGoal["designs"][number]["acceptance"][number] & {
      supported: boolean;
      evidence: Array<{ id: string; locator: string; summary: string; observedAt: string }>;
    }>;
  }> }>;
  principles: GoalSource[];
  unassociated: GoalSource[];
  warnings: string[];
}
