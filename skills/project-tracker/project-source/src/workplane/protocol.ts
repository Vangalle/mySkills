/**
 * Tracker-side Workplane protocol.
 *
 * Workplane is an optional CLI plugin. Tracker sends one bounded snapshot of
 * its own canonical State/evidence plus the project's `WORKPLANE.json`, then
 * validates the plugin's response before showing anything. Nothing here reads
 * or writes `PROJECT_STATE.md`.
 */
import { z } from "zod";

export const WORKPLANE_PROTOCOL_VERSION = "workplane.plugin/v1";
export const WORKPLANE_API_VERSION = "workplane/v1";

export interface WorkplaneTrackerSnapshot {
  schemaVersion: 1;
  project: { name: string; root: string };
  projectGoal: { statement: string } | null;
  goals: Array<{
    id: string;
    title: string;
    designs: Array<{
      id: string;
      title: string;
      path: string;
      parents: string[] | null;
      progress: Array<{ id: string; recordedAt: string; text: string; evidenceIds: string[]; gitRefs: string[] }>;
      acceptance: Array<{ id: string; criterion: string; complete: boolean; evidenceIds: string[] }>;
    }>;
  }>;
  git: { head: string };
  verification: Array<{
    id?: string;
    command: string;
    result: "PASS" | "FAIL" | "ERROR";
    verifiedAt: string;
    freshness: "current" | "stale" | "unbound";
  }>;
}

const designProgressSchema = z
  .object({
    id: z.string().min(1),
    recordedAt: z.string().min(1),
    text: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    gitRefs: z.array(z.string()).default([]),
  })
  .passthrough();

const designAcceptanceSchema = z
  .object({
    id: z.string().min(1),
    criterion: z.string(),
    complete: z.boolean(),
    evidenceIds: z.array(z.string()).default([]),
  })
  .passthrough();

const designSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    path: z.string(),
    parents: z.array(z.string()).nullable(),
    progress: z.array(designProgressSchema),
    acceptance: z.array(designAcceptanceSchema),
    unitIds: z.array(z.string()),
  })
  .passthrough();

const goalSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    designs: z.array(designSchema),
  })
  .passthrough();

const hierarchyNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    kind: z.enum(["goal", "group", "unit"]),
    parent: z.string().nullable(),
    depth: z.number(),
    ancestors: z.array(z.string()),
    children: z.array(z.string()),
  })
  .passthrough();

const resolvedCheckSchema = z
  .object({
    status: z.string(),
    freshness: z.string().nullable(),
    command: z.string().optional(),
    evidenceId: z.string().nullable().optional(),
    verifiedAt: z.string().optional(),
  })
  .passthrough();

const planeUnitSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    kind: z.string(),
    status: z.string(),
    progress: z.object({ satisfied: z.number(), total: z.number() }).passthrough(),
    acceptance: z.array(z.object({ resolved: resolvedCheckSchema }).passthrough()),
    designs: z.array(z.object({ goalId: z.string(), designId: z.string(), title: z.string() }).passthrough()),
  })
  .passthrough();

const bridgeLinkSchema = z.object({
  goalId: z.string().min(1),
  designId: z.string().min(1),
  unitIds: z.array(z.string().min(1)),
});

const planeDocumentSchema = z
  .object({
    apiVersion: z.literal(WORKPLANE_API_VERSION),
    generatedAt: z.string().min(1),
    project: z
      .object({
        name: z.string().min(1),
        root: z.string(),
        goalStatement: z.string().nullable(),
      })
      .passthrough(),
    glossary: z.array(z.record(z.string(), z.unknown())).optional(),
    hierarchy: z
      .object({
        rootId: z.string().min(1),
        nodes: z.array(hierarchyNodeSchema),
      })
      .passthrough(),
    goals: z.array(goalSchema),
    designImpacts: z.array(bridgeLinkSchema),
    units: z.array(planeUnitSchema),
    coverage: z
      .object({
        units: z.number(),
        defined: z.number(),
        delivered: z.number(),
        withEvidence: z.number(),
        orphan: z.array(z.string()),
      })
      .passthrough(),
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

const pluginErrorSchema = z.object({ path: z.string(), message: z.string().min(1) });

export const PluginResponseSchema = z.union([
  z
    .object({
      protocolVersion: z.literal(WORKPLANE_PROTOCOL_VERSION),
      status: z.literal("ok"),
      document: planeDocumentSchema,
      html: z.string().min(1),
      mermaid: z.string().min(1),
    })
    .strict(),
  z
    .object({
      protocolVersion: z.literal(WORKPLANE_PROTOCOL_VERSION),
      status: z.literal("invalid"),
      errors: z.array(pluginErrorSchema).min(1),
    })
    .strict(),
]);

export type PluginResponse = z.infer<typeof PluginResponseSchema>;
