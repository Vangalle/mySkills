/**
 * Project discovery (section 3.1).
 *
 * Canonical realpath + git plumbing only. Adjacent directories such as
 * /repo and /repo-copy must never be confused via string prefixes.
 */
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { execa } from "execa";
import type { ProjectScope } from "../contracts.js";
import type { CollectionReporter } from "../analysis/collection.js";

export type DiscoveryResult =
  | { ok: true; scope: ProjectScope }
  | { ok: false; kind: "not_found" | "not_git" | "bare_repo"; message: string };

export async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/** True when `candidate` is inside or equal to `scopeRoot` (canonical paths). */
export function isWithinPath(scopeRoot: string, candidate: string): boolean {
  if (scopeRoot === candidate) return true;
  if (!scopeRoot.endsWith("/")) scopeRoot = `${scopeRoot}/`;
  if (!candidate.endsWith("/")) candidate = `${candidate}/`;
  return candidate.startsWith(scopeRoot);
}

export async function gitRootOf(dir: string): Promise<string | null> {
  const { failed, stdout } = await execa(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: dir, reject: false },
  );
  if (failed || !stdout.trim()) return null;
  return stdout.trim();
}

export async function isBareRepo(dir: string): Promise<boolean> {
  const { stdout } = await execa("git", ["rev-parse", "--is-bare-repository"], {
    cwd: dir,
    reject: false,
  });
  return stdout.trim() === "true";
}

export async function listWorktrees(gitDir: string, onIssue?: CollectionReporter): Promise<Array<{ path: string; head: string; branch: string | null }>> {
  const { failed, stdout } = await execa("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: gitDir,
    reject: false,
  });
  if (failed) {
    onIssue?.({ source: "git", code: "git_read_failed", message: "Git 工作区列表没能读完整。" });
    return [];
  }
  const out: Array<{ path: string; head: string; branch: string | null }> = [];
  let current: { path: string; head: string; branch: string | null } | null = null;
  for (const record of stdout.split("\0")) {
    for (const line of record.split("\n")) {
      if (!line) continue;
      if (line.startsWith("worktree ")) {
        if (current) out.push(current);
        current = { path: line.slice("worktree ".length), head: "", branch: null };
      } else if (line.startsWith("HEAD ") && current) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ") && current) {
        current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Discover the project scope for an input path. Returns a typed result
 * instead of throwing for non-git dirs and bare repos.
 */
export async function discoverProject(
  inputPath: string,
  options: { extraProjectPaths?: string[] } = {},
): Promise<DiscoveryResult> {
  const canonicalInput = await realpathOrNull(inputPath);
  if (!canonicalInput) {
    return { ok: false, kind: "not_found", message: `path does not exist: ${inputPath}` };
  }

  const root = await gitRootOf(canonicalInput);
  if (!root) {
    // A bare repo has no work tree, so --show-toplevel fails; classify it
    // explicitly instead of reporting a generic non-git directory.
    if (await isBareRepo(canonicalInput)) {
      return { ok: false, kind: "bare_repo", message: `bare repository: ${canonicalInput}` };
    }
    return {
      ok: false,
      kind: "not_git",
      message: `not inside a git repository: ${canonicalInput}`,
    };
  }
  const rootReal = (await realpathOrNull(root)) ?? root;

  if (await isBareRepo(rootReal)) {
    return { ok: false, kind: "bare_repo", message: `bare repository: ${rootReal}` };
  }

  const worktreeEntries = await listWorktrees(rootReal);
  const worktrees = await Promise.all(
    worktreeEntries.map(async (w) => (await realpathOrNull(w.path)) ?? w.path),
  );

  const extraPaths: string[] = [];
  for (const extra of options.extraProjectPaths ?? []) {
    const canonical = await realpathOrNull(extra);
    if (canonical) extraPaths.push(canonical);
  }

  return {
    ok: true,
    scope: {
      name: basename(rootReal),
      root: rootReal,
      worktrees,
      extraPaths,
      isGit: true,
      isBare: false,
    },
  };
}