import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseProjectState } from "./markdown-parser.js";
import { StateProposalSchema } from "../contracts.js";

/** Superseded State is archived as a file, never embedded in the new document. */
export const STATE_BACKUP_DIR = "bak";
export const STATE_BACKUP_NAME = `${STATE_BACKUP_DIR}/PROJECT_STATE.md`;
/** Bounded, regular-file, no-symlink read. Missing is distinct from unreadable. */
export async function readStateSnapshot(root: string, fileName = "PROJECT_STATE.md") {
  if (!fileName || /[/\\]/.test(fileName) || [".", ".."].includes(fileName)) throw new Error("State filename must be project-local");
  const path = join(root, fileName);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (!handle) return { path, markdown: null, hash: null };
  try {
    const stat = await handle.stat(); const limit = 2 * 1024 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error("State must be a bounded regular file");
    const buffer = Buffer.alloc(limit + 1); let count = 0;
    while (count < buffer.length) { const r = await handle.read(buffer, count, buffer.length - count, null); if (!r.bytesRead) break; count += r.bytesRead; }
    if (count > limit) throw new Error("State exceeds read limit");
    const bytes = buffer.subarray(0, count);
    return { path, markdown: new TextDecoder("utf-8", { fatal: true }).decode(bytes), hash: createHash("sha256").update(bytes).digest("hex") };
  } finally { await handle.close(); }
}
/** Conservative definition of structural replacement: losing prior history,
 * source associations, criteria, edges or human sections requires backup choice.
 * An append, title correction or current acceptance update does not. */
export async function replacementNeedsBackup(root: string, nextMarkdown: string, fileName = "PROJECT_STATE.md") {
  const snapshot = await readStateSnapshot(root, fileName);
  if (snapshot.markdown === null || snapshot.markdown === nextMarkdown) return false;
  const before = parseProjectState(snapshot.markdown), after = parseProjectState(nextMarkdown);
  const old = StateProposalSchema.safeParse(before.proposal), next = StateProposalSchema.safeParse(after.proposal);
  if (!old.success || !next.success || old.data.schemaVersion !== 2 || next.data.schemaVersion !== 2) return true;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before.unknownSections.some(n => !after.unknownSections.some(m => m.title === n.title && m.body === n.body))) return true;
  const target = next.data;
  for (const goal of old.data.goals) {
    const g = target.goals.find(g => g.id === goal.id); if (!g) return true;
    for (const design of goal.designs) {
      const d = g.designs.find(d => d.id === design.id); if (!d) return true;
      if (d.path !== design.path || !equal(d.parents, design.parents) || (design.taskPaths ?? []).some(p => !d.taskPaths?.includes(p))) return true;
      if (design.progress.some(r => !d.progress.some(n => equal(n, r)))) return true;
      if (design.acceptance.some(a => !d.acceptance.some(n => n.id === a.id && n.criterion === a.criterion))) return true;
    }
  }
  const withoutFreshness = ({ freshness: _f, ...v }: typeof old.data.verification[number]) => v;
  if (old.data.verification.some(v => !target.verification.some(n => equal(withoutFreshness(n), withoutFreshness(v))))) return true;
  return false;
}

export async function inspectState(root: string, fileName = "PROJECT_STATE.md") {
  const snapshot = await readStateSnapshot(root, fileName);
  const parsed = snapshot.markdown === null ? null : parseProjectState(snapshot.markdown);
  const valid = StateProposalSchema.safeParse(parsed?.proposal);
  const status = snapshot.markdown === null ? "missing" : !valid.success ? "incompatible" : valid.data.schemaVersion === 1 ? "legacy" : "compatible";
  return { path: snapshot.path, expectedHash: snapshot.hash, status, backupName: STATE_BACKUP_NAME,
    requiresReview: status === "legacy" || status === "incompatible" };
}
