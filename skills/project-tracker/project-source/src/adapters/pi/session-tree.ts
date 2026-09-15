/**
 * Session tree rules (section 3.3).
 *
 * Supports v1 linear records (prevId), v2 tree records (parentId) and
 * v3 custom-role records. The last valid entry in file order is the active
 * leaf; walking parentId/prevId recovers the active branch. Entries outside
 * the active branch are "abandoned" — their conclusions must not be treated
 * as the current project state.
 */

export interface TreeEntry {
  id: string;
  parentId: string | null;
}

export interface TreeInfo {
  /** Ordered root → leaf. */
  activeBranch: TreeEntry[];
  activeLeafId: string | null;
  abandonedBranchIds: string[];
  branchCount: number;
  warnings: string[];
}

export function buildTreeInfo(entries: TreeEntry[]): TreeInfo {
  const warnings: string[] = [];
  if (entries.length === 0) {
    return { activeBranch: [], activeLeafId: null, abandonedBranchIds: [], branchCount: 0, warnings };
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const activeLeaf = entries[entries.length - 1]!;
  const activeBranch: TreeEntry[] = [];
  const onBranch = new Set<string>();

  let cursor: TreeEntry | undefined = activeLeaf;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    activeBranch.unshift(cursor);
    onBranch.add(cursor.id);
    if (cursor.parentId === null) break;
    const parent = byId.get(cursor.parentId);
    if (!parent) {
      warnings.push(`parent entry not found: ${cursor.parentId}`);
      break;
    }
    cursor = parent;
  }

  // Branch points: entries with more than one direct child.
  const childrenOf = new Map<string, number>();
  for (const entry of entries) {
    if (entry.parentId === null) continue;
    childrenOf.set(entry.parentId, (childrenOf.get(entry.parentId) ?? 0) + 1);
  }
  const branchCount = [...childrenOf.values()].filter((n) => n > 1).length;

  // Abandoned branches: side branches that never re-join the active branch.
  const abandonedBranchIds = entries
    .filter((e) => !onBranch.has(e.id) && e.parentId !== null && onBranch.has(e.parentId))
    .map((e) => e.id);

  return { activeBranch, activeLeafId: activeLeaf.id, abandonedBranchIds, branchCount, warnings };
}

/** True when an assistant conclusion may be treated as a completion claim. */
export function isCompletionClaim(stopReason: string | undefined): boolean {
  const r = (stopReason ?? "stop").toLowerCase();
  return r === "stop" || r === "end_turn";
}