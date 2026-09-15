/** The automatic write surface can append records, never replace a design or goal. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { z } from "zod";
import { DesignStateProposalSchema, type DesignStateProposal, type ProjectEvidence } from "../contracts.js";
import { HistoryIdSchema, ProgressRecordSchema } from "./design-history.js";
import { parseProjectState } from "./markdown-parser.js";
import { renderProjectState } from "./markdown-renderer.js";
import { applyStateUpdate } from "./atomic-writer.js";

export const ProgressAppendSchema = z.object({ goalId: HistoryIdSchema, designId: HistoryIdSchema, record: ProgressRecordSchema }).strict();
export type ProgressAppend = z.infer<typeof ProgressAppendSchema>;
export function appendProgress(state: DesignStateProposal, raw: ProgressAppend): { proposal: DesignStateProposal; appended: boolean } {
  const input = ProgressAppendSchema.parse(raw);
  const copy = DesignStateProposalSchema.parse(state);
  const design = copy.goals.find(g => g.id === input.goalId)?.designs.find(d => d.id === input.designId);
  if (!design) throw new Error("unknown design; automatic records cannot create or change designs");
  const existing = design.progress.find(r => r.id === input.record.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(input.record)) throw new Error("record ID conflicts with existing history");
    return { proposal: state, appended: false };
  }
  design.progress.push(input.record);
  return { proposal: copy, appended: true };
}

export async function recordProgress(root: string, raw: ProgressAppend, evidence: ProjectEvidence, fileName = "PROJECT_STATE.md") {
  root = await realpath(root);
  if (evidence.project.root !== root || evidence.collection?.complete !== true) throw new Error("record requires complete evidence for the target project");
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") throw new Error("State filename must be project-local");
  const path = join(root, fileName);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("State must be a regular project file");
  const markdown = await readFile(path, "utf8");
  const parsed = parseProjectState(markdown);
  if (parsed.proposal?.schemaVersion !== 2) throw new Error(parsed.schemaVersion === 2
    ? "State v2 is invalid or noncanonical; refusing a potentially lossy rewrite"
    : "automatic records require established v2 State; review a migration first");
  const input = ProgressAppendSchema.parse(raw);
  const next = appendProgress(parsed.proposal, input);
  if (!next.appended) return { appended: false, path, recordId: input.record.id };
  const refs = new Map(evidence.references.map(ref => [ref.id, ref]));
  for (const id of input.record.evidenceIds) {
    if (!refs.has(id)) throw new Error(`unknown new record evidence: ${id}`);
    if (id.startsWith("verify:")) {
      const observed = evidence.verification.find(r => r.id === id);
      if (!observed || refs.get(id)?.source !== "verification") throw new Error(`verification record unavailable: ${id}`);
      const stored = next.proposal.verification.find(r => r.id === id);
      const { freshness: _freshness, ...snapshot } = observed;
      if (stored) {
        const { freshness: _storedFreshness, ...old } = stored;
        if (JSON.stringify(old) !== JSON.stringify(snapshot)) throw new Error(`verification ID conflicts with stored history: ${id}`);
      } else next.proposal.verification.push(snapshot);
    }
  }
  for (const ref of input.record.gitRefs) {
    const result = await execa("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, reject: false });
    if (result.exitCode !== 0) throw new Error(`unknown commit: ${ref}`);
  }
  const expectedHash = createHash("sha256").update(markdown).digest("hex");
  await applyStateUpdate(path, expectedHash, renderProjectState(next.proposal, parsed));
  return { appended: true, path, recordId: input.record.id };
}
