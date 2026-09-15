/**
 * Git evidence adapter (section 2.2).
 *
 * Only plumbing/porcelain output is parsed — never localized, colored
 * human-readable output.
 */
import { execa } from "execa";
import type { GitEvidence, ProjectScope } from "../contracts.js";
import { listWorktrees } from "../discovery/project-discovery.js";
import type { CollectionReporter } from "../analysis/collection.js";

async function readGit(root: string, args: string[], onIssue?: CollectionReporter): Promise<string> {
  const result = await execa("git", args, { cwd: root, reject: false });
  if (result.failed) {
    onIssue?.({ source: "git", code: "git_read_failed", message: `Git ${args[0]} 信息没能读完整。` });
    return "";
  }
  return result.stdout;
}

function splitZero(out: string): string[] {
  return out.split("\0").filter((s) => s.length > 0);
}

export async function gitStatus(gitDir: string, onIssue?: CollectionReporter): Promise<{
  changed: GitEvidence["changed"];
  untrackedPaths: string[];
}> {
  const stdout = await readGit(gitDir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], onIssue);
  const changed: GitEvidence["changed"] = [];
  const untrackedPaths: string[] = [];

  // -z entries are: XY <path> for tracked, "?? <path>\0" for untracked.
  for (const entry of splitZero(stdout)) {
    if (entry.startsWith("?? ")) {
      const path = entry.slice(3);
      untrackedPaths.push(path);
      changed.push({ path, index: "?", worktree: "?" });
    } else if (entry.length > 3) {
      changed.push({
        path: entry.slice(3),
        index: entry[0]!,
        worktree: entry[1]!,
      });
    }
  }
  return { changed, untrackedPaths };
}

export async function aheadBehind(gitDir: string, onIssue?: CollectionReporter): Promise<{ ahead: number; behind: number; upstream: string | null }> {
  const noUpstream = { ahead: 0, behind: 0, upstream: null };
  const branch = await execa("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: gitDir, reject: false });
  if (branch.failed) {
    // Exit 1 is the documented detached-HEAD case, not a failed scan.
    if (branch.exitCode !== 1) {
      onIssue?.({ source: "git", code: "git_read_failed", message: "Git 分支信息没能读完整。" });
    }
    return noUpstream;
  }
  const configured = await readGit(gitDir, ["for-each-ref", "--format=%(upstream)", branch.stdout.trim()], onIssue);
  if (!configured.trim()) return noUpstream;
  const stdout = await readGit(gitDir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], onIssue);
  const m = /^(\d+)\s+(\d+)$/.exec(stdout.trim());
  if (!m) return noUpstream;
  const upstreamName = await readGit(gitDir, ["rev-parse", "--abbrev-ref", "@{upstream}"], onIssue);
  return {
    ahead: Number(m[1]!),
    behind: Number(m[2]!),
    upstream: upstreamName.trim() || null,
  };
}

export async function diffStat(gitDir: string, untrackedPaths: string[], onIssue?: CollectionReporter): Promise<GitEvidence["diffStat"]> {
  const stdout = await readGit(gitDir, ["diff", "HEAD", "--numstat", "-z"], onIssue);
  const stat: GitEvidence["diffStat"] = [];
  // numstat -z records: added<TAB>deleted<TAB>path (with NUL separators).
  for (const record of stdout.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(record);
    if (!m) continue;
    stat.push({
      path: m[3]!,
      added: m[1] === "-" ? 0 : Number(m[1]),
      deleted: m[2] === "-" ? 0 : Number(m[2]),
      untracked: false,
    });
  }
  for (const path of untrackedPaths) {
    stat.push({ path, added: 0, deleted: 0, untracked: true });
  }
  return stat;
}

export async function collectGitEvidence(scope: ProjectScope, onIssue?: CollectionReporter): Promise<GitEvidence> {
  const root = scope.root;
  const head = (await readGit(root, ["rev-parse", "HEAD"], onIssue)).trim();
  const branchRef = (await readGit(root, ["rev-parse", "--abbrev-ref", "HEAD"], onIssue)).trim();
  const branch = !branchRef || branchRef === "HEAD" ? null : branchRef;

  const { changed, untrackedPaths } = await gitStatus(root, onIssue);
  const { ahead, behind, upstream } = await aheadBehind(root, onIssue);
  const logOut = await readGit(root, ["log", "--max-count=30", "--pretty=format:%x1f%H%x1f%aI%x1f%s"], onIssue);
  const recentCommits = logOut
    .split("\n")
    .filter((line) => line.startsWith("\x1f"))
    .map((line) => {
      const [hash = "", authoredAt = "", ...subjectParts] = line.slice(1).split("\x1f");
      return { hash, authoredAt, subject: subjectParts.join("\x1f") };
    });

  const worktrees = await listWorktrees(root, onIssue);

  const evidence: GitEvidence = {
    branch,
    head,
    upstream,
    ahead,
    behind,
    changed,
    recentCommits,
    worktrees,
    diffStat: await diffStat(root, untrackedPaths, onIssue),
  };
  return evidence;
}