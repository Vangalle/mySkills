import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execa } from "execa";
import { z } from "zod";
import {
  VerificationRecordSchema,
  type VerificationRecord,
} from "../contracts.js";

export const VERIFICATION_STORE_PATH = ".project-tracker/verification.json";
const STORE_VERSION = 1;

const VerificationStoreSchema = z.object({
  schemaVersion: z.literal(STORE_VERSION).optional(),
  verification: z.array(VerificationRecordSchema),
});

export interface WorkspaceSnapshot {
  projectRoot: string;
  head: string;
  contentFingerprint: string;
}

export interface VerificationLoadResult {
  records: VerificationRecord[];
  diagnostic?: string;
}

function hashField(hash: ReturnType<typeof createHash>, value: string | Buffer): void {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  hash.update(String(buffer.length));
  hash.update(":");
  hash.update(buffer);
  hash.update("\0");
}

function isExcluded(relativePath: string): boolean {
  return (
    relativePath === "PROJECT_STATE.md" ||
    relativePath === ".project-tracker" ||
    relativePath.startsWith(".project-tracker/") ||
    relativePath === ".codegraph" ||
    relativePath.startsWith(".codegraph/")
  );
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function hashRegularFile(path: string): Promise<{ digest: string; stable: boolean }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    return {
      digest: hash.digest("hex"),
      stable:
        before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Hash the checked-out contents of every tracked and nonignored untracked file.
 * Symlinks contribute their link text only; their targets are never opened.
 */
export async function contentFingerprint(projectRoot: string): Promise<string> {
  const root = await realpath(projectRoot);
  const listed = await execa(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, reject: false },
  );
  if (listed.failed) {
    throw new Error(`cannot enumerate project files for verification: ${listed.stderr || "git ls-files failed"}`);
  }

  const paths = listed.stdout
    .split("\0")
    .filter(Boolean)
    .filter((path) => !isExcluded(path))
    .sort((a, b) => a.localeCompare(b));
  const aggregate = createHash("sha256");

  for (const relativePath of paths) {
    hashField(aggregate, relativePath);
    const candidate = resolve(root, relativePath);
    if (!isWithinRoot(root, candidate)) {
      hashField(aggregate, "outside-path");
      continue;
    }

    try {
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) {
        hashField(aggregate, "symlink");
        hashField(aggregate, await readlink(candidate));
        continue;
      }
      if (!stat.isFile()) {
        hashField(aggregate, stat.isDirectory() ? "directory" : "special");
        continue;
      }

      const canonical = await realpath(candidate);
      if (!isWithinRoot(root, canonical)) {
        hashField(aggregate, "outside-target");
        continue;
      }
      const file = await hashRegularFile(canonical);
      hashField(aggregate, "file");
      hashField(aggregate, file.digest);
      hashField(aggregate, file.stable ? "stable" : "changed-during-read");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      hashField(aggregate, `unreadable:${code}`);
    }
  }

  return aggregate.digest("hex");
}

export async function captureWorkspaceSnapshot(projectRoot: string): Promise<WorkspaceSnapshot> {
  const root = await realpath(projectRoot);
  const headResult = await execa("git", ["rev-parse", "HEAD"], { cwd: root, reject: false });
  if (headResult.failed || !headResult.stdout.trim()) {
    throw new Error("cannot bind verification to the current Git HEAD");
  }
  return {
    projectRoot: root,
    head: headResult.stdout.trim(),
    contentFingerprint: await contentFingerprint(root),
  };
}

export function snapshotsMatch(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  return (
    a.projectRoot === b.projectRoot &&
    a.head === b.head &&
    a.contentFingerprint === b.contentFingerprint
  );
}

export function verificationEvidenceId(record: VerificationRecord, index: number): string {
  return record.id ?? `verify:${index}`;
}

export function isCurrentPassingVerification(record: VerificationRecord): boolean {
  return record.result === "PASS" && record.freshness === "current";
}

export function parseVerificationPayload(raw: unknown): VerificationRecord[] {
  if (Array.isArray(raw)) return z.array(VerificationRecordSchema).parse(raw);
  return VerificationStoreSchema.parse(raw).verification;
}

export async function classifyVerificationRecords(
  projectRoot: string,
  records: VerificationRecord[],
): Promise<VerificationRecord[]> {
  const current = await captureWorkspaceSnapshot(projectRoot);
  return records.map((record) => {
    const { freshness: _ignored, ...storedRecord } = record;
    if (!record.binding) return { ...storedRecord, freshness: "unbound" as const };
    const boundSnapshot: WorkspaceSnapshot = {
      projectRoot: record.binding.projectRoot,
      head: record.binding.head,
      contentFingerprint: record.binding.contentFingerprint,
    };
    const freshness =
      record.binding.stable && snapshotsMatch(boundSnapshot, current) ? "current" : "stale";
    return { ...storedRecord, freshness };
  });
}

function storePaths(projectRoot: string): { dir: string; file: string } {
  const dir = join(projectRoot, ".project-tracker");
  return { dir, file: join(dir, "verification.json") };
}

async function safeStoreDirectory(projectRoot: string, create: boolean): Promise<string | null> {
  const root = await realpath(projectRoot);
  const { dir } = storePaths(root);
  if (create) await mkdir(dir, { recursive: true });
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${dir} must be a real directory inside the project root`);
    }
    return dir;
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeVerificationStore(
  projectRoot: string,
  records: VerificationRecord[],
): Promise<void> {
  const root = await realpath(projectRoot);
  const dir = await safeStoreDirectory(root, true);
  if (!dir) throw new Error("verification store directory is unavailable");
  const file = join(dir, "verification.json");
  const existing = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) {
    throw new Error(`${file} must not be a symbolic link`);
  }

  const cleanRecords = records.map(({ freshness: _freshness, ...record }) => record);
  const payload = VerificationStoreSchema.parse({
    schemaVersion: STORE_VERSION,
    verification: cleanRecords,
  });
  const tmp = join(dir, `.verification.json.tmp-${process.pid}-${Date.now()}`);
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function loadVerificationStore(projectRoot: string): Promise<VerificationLoadResult> {
  try {
    const root = await realpath(projectRoot);
    const dir = await safeStoreDirectory(root, false);
    if (!dir) return { records: [] };
    const file = join(dir, "verification.json");
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return { records: [], diagnostic: `ignored unsafe verification store: ${file}` };
    }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text: string;
    try {
      text = await readFile(handle, "utf8");
    } finally {
      await handle.close();
    }
    const records = parseVerificationPayload(JSON.parse(text));
    return { records: await classifyVerificationRecords(root, records) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [] };
    return {
      records: [],
      diagnostic: `ignored corrupt verification store: ${(error as Error).message}`,
    };
  }
}
