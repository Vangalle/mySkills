/**
 * Atomic PROJECT_STATE.md writer (section 4.2).
 *
 * Updates follow a strict handshake:
 *   1. previewStateUpdate computes new markdown + the sha256 of the CURRENT
 *      file (expectedHash).
 *   2. The caller authorizes the semantic change (diagram-reviewed definitions
 *      or an already-authorized restricted progress append).
 *   3. applyStateUpdate refuses to write when the on-disk hash no longer
 *      matches expectedHash (state_changed_since_preview) and otherwise writes
 *      a temp file, fsyncs it and atomically renames it over the target.
 */
import { createHash } from "node:crypto";
import { open, rename, readFile, rm, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { StateProposal, ParsedProjectState } from "../contracts.js";
import { renderProjectState } from "./markdown-renderer.js";
import { STATE_BACKUP_NAME } from "./onboarding.js";

export class StateChangedError extends Error {
  readonly code = "state_changed_since_preview";
  constructor(message = "PROJECT_STATE.md changed since the preview was generated") {
    super(message);
    this.name = "StateChangedError";
  }
}

export async function fileHash(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    return createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface StateDiff {
  path: string;
  oldMarkdown: string | null;
  newMarkdown: string;
  /** sha256 of the file at preview time; null when the file does not exist. */
  expectedHash: string | null;
  unifiedDiff: string;
}

export async function previewStateUpdate(
  path: string,
  proposal: StateProposal,
  options: { existing?: ParsedProjectState | null; lastVerifiedAt?: string } = {},
): Promise<StateDiff> {
  const oldMarkdown = await readFile(path, "utf8").catch(() => null);
  const newMarkdown = renderProjectState(proposal, options.existing, {
    lastVerifiedAt: options.lastVerifiedAt,
  });
  const unifiedDiff = oldMarkdown
    ? createTwoFilesPatch(path, path, oldMarkdown, newMarkdown, "", "", { context: 3 })
    : createTwoFilesPatch("/dev/null", path, "", newMarkdown, "", "", { context: 3 });

  return {
    path,
    oldMarkdown,
    newMarkdown,
    expectedHash: oldMarkdown === null ? null : createHash("sha256").update(oldMarkdown).digest("hex"),
    unifiedDiff,
  };
}

/**
 * Atomically write `markdown` to `path`, but only when the current content hash
 * equals `expectedHash`. The original file is never left partially written.
 */
export async function applyStateUpdate(
  path: string,
  expectedHash: string | null,
  markdown: string,
  options: { backupOriginal?: boolean } = {},
): Promise<void> {
  const dir = dirname(path);
  const lockPath = join(dir, `.${basename(path)}.lock`);
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new StateChangedError("State writer is busy; retry from the latest State");
    throw error;
  });
  const tmpPath = join(dir, `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("State must be a regular file");
    if (await fileHash(path) !== expectedHash) throw new StateChangedError();
    const handle = await open(tmpPath, "wx");
    try { await handle.writeFile(markdown, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    if (options.backupOriginal) {
      if (!stat) throw new Error("No original State to back up");
      const original = await readFile(path);
      if (createHash("sha256").update(original).digest("hex") !== expectedHash) throw new StateChangedError();
      const backupPath = join(dir, STATE_BACKUP_NAME);
      const backup = await open(backupPath, "wx", 0o600); // never overwrite another backup
      try { await backup.writeFile(original); await backup.sync(); }
      catch (error) { await backup.close(); await rm(backupPath, { force: true }); throw error; }
      await backup.close();
    }
    if (await fileHash(path) !== expectedHash) throw new StateChangedError();
    await rename(tmpPath, path);
  } finally {
    await rm(tmpPath, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}