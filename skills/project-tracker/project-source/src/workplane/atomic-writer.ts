/**
 * Reviewed, atomic `WORKPLANE.json` writes.
 *
 * Definition changes follow an explicit handshake separate from State writes:
 *   1. preview validates a candidate through the Workplane plugin and pins the
 *      current target hash plus the Tracker structure hash;
 *   2. the user reviews the diff;
 *   3. apply re-checks both hashes, re-runs semantic validation, takes a
 *      Workplane-specific lock and atomically renames a fsynced temp file.
 *
 * `PROJECT_STATE.md` is never touched here.
 */
import { createHash } from "node:crypto";
import { lstat, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { fileHash } from "../state/atomic-writer.js";

export interface WorkplaneValidationReceipt {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

export type WorkplaneValidationResult =
  | { status: "ready"; receipt: WorkplaneValidationReceipt }
  | { status: "invalid"; message: string; errors: string[] };

export interface WorkplanePreview {
  path: string;
  expectedHash: string | null;
  trackerStructureHash: string;
  nextJson: string;
  unifiedDiff: string;
  receipt: WorkplaneValidationReceipt;
}

export const WorkplanePreviewSchema = z
  .object({
    path: z.string().min(1),
    expectedHash: z.string().nullable(),
    trackerStructureHash: z.string().min(1),
    nextJson: z.string(),
    unifiedDiff: z.string(),
    receipt: z.object({
      pass: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  })
  .strict();

export class WorkplaneChangedError extends Error {
  readonly code = "workplane_changed_since_preview";
  constructor(message = "WORKPLANE.json or Tracker structure changed since the preview was generated") {
    super(message);
    this.name = "WorkplaneChangedError";
  }
}

function canonicalJson(definition: unknown): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

function lockPathFor(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.lock`);
}

async function assertRegularTarget(targetPath: string): Promise<void> {
  const info = await lstat(targetPath).then(
    (value) => value,
    (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)),
  );
  if (info && (info.isSymbolicLink() || !info.isFile())) {
    throw new Error("WORKPLANE.json must be a regular file, not a symlink or directory");
  }
}

function rejectionReason(validation: Exclude<WorkplaneValidationResult, { status: "ready" }>): string {
  const parts = [validation.message, ...validation.errors].filter((part) => part && part.length > 0);
  return parts.join("; ") || "workplane definition is invalid";
}

export async function previewWorkplaneUpdate(options: {
  targetPath: string;
  definition: unknown;
  trackerStructureHash: string;
  validate: () => Promise<WorkplaneValidationResult>;
}): Promise<WorkplanePreview> {
  const { targetPath, definition, trackerStructureHash, validate } = options;
  await assertRegularTarget(targetPath);

  const validation = await validate();
  if (validation.status !== "ready") throw new Error(rejectionReason(validation));

  const oldContent = await readFile(targetPath, "utf8").catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? null : Promise.reject(error),
  );
  const nextJson = canonicalJson(definition);
  const unifiedDiff =
    oldContent === null
      ? createTwoFilesPatch("/dev/null", targetPath, "", nextJson, "", "", { context: 3 })
      : createTwoFilesPatch(targetPath, targetPath, oldContent, nextJson, "", "", { context: 3 });

  return {
    path: targetPath,
    expectedHash: oldContent === null ? null : createHash("sha256").update(oldContent).digest("hex"),
    trackerStructureHash,
    nextJson,
    unifiedDiff,
    receipt: validation.receipt,
  };
}

export async function applyWorkplaneUpdate(options: {
  targetPath: string;
  preview: WorkplanePreview;
  trackerStructureHash: string;
  validate: () => Promise<WorkplaneValidationResult>;
}): Promise<void> {
  const { targetPath, preview, trackerStructureHash, validate } = options;
  if (preview.path !== targetPath) throw new WorkplaneChangedError("preview belongs to a different WORKPLANE.json");
  if (preview.trackerStructureHash !== trackerStructureHash) {
    throw new WorkplaneChangedError("Tracker Goal/Design structure changed since the preview was generated");
  }
  await assertRegularTarget(targetPath);
  if ((await fileHash(targetPath)) !== preview.expectedHash) throw new WorkplaneChangedError();

  const validation = await validate();
  if (validation.status !== "ready") throw new Error(rejectionReason(validation));

  const lockPath = lockPathFor(targetPath);
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new WorkplaneChangedError("WORKPLANE.json writer is busy; retry from the latest preview");
    throw error;
  });
  const tmpPath = join(dirname(targetPath), `.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    if ((await fileHash(targetPath)) !== preview.expectedHash) throw new WorkplaneChangedError();
    const handle = await open(tmpPath, "wx");
    try {
      await handle.writeFile(preview.nextJson, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await fileHash(targetPath)) !== preview.expectedHash) throw new WorkplaneChangedError();
    await rename(tmpPath, targetPath);
  } finally {
    await rm(tmpPath, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
