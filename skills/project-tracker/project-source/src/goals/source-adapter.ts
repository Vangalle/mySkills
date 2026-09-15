/** Read upstream Markdown as bounded, inert data. No upstream lifecycle is recreated. */
import { readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectGoal, DesignStateProposal, VerificationRecord } from "../contracts.js";
import type { FeatureGoal } from "../state/design-history.js";
import { contained, PRINCIPLE_PATHS, readProjectDocument } from "./document-source.js";
import { acceptanceHasCurrentEvidence, type ProposalEvidenceContext } from "../state/state-schema.js";
import type { GoalOverview, GoalSource } from "./types.js";


const MAX_SOURCES = 150;

async function discoverSources(root: string): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  let visited = 0;
  let truncated = false;
  async function walk(path: string, depth: number) {
    if (visited++ >= MAX_SOURCES || paths.length >= MAX_SOURCES) { truncated = true; return; }
    if (depth > 6) { truncated = true; return; }
    try {
      if (!contained(root, await realpath(resolve(root, path)))) return;
      const entries = await readdir(resolve(root, path), { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (paths.length >= MAX_SOURCES) { truncated = true; break; }
        if (entry.isSymbolicLink()) continue;
        const child = `${path}/${entry.name}`;
        if (entry.isDirectory()) await walk(child, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(child);
      }
    } catch { /* optional upstream directories may not exist */ }
  }
  await walk("openspec/changes", 0);
  await walk("openspec/specs", 0);
  await walk("specs", 0);
  return { paths, truncated };
}

export async function buildGoalOverview(
  projectRoot: string,
  goals: Array<ProjectGoal | FeatureGoal> | undefined,
  evidence: ProposalEvidenceContext,
  projectGoal: DesignStateProposal["projectGoal"] = null,
  historicalVerification: VerificationRecord[] = [],
): Promise<GoalOverview> {
  const root = await realpath(projectRoot);
  const sources = new Map<string, Promise<GoalSource>>();
  const read = (path: string) => {
    if (!sources.has(path)) sources.set(path, readProjectDocument(root, path));
    return sources.get(path)!;
  };
  const associated = new Set<string>();
  const viewGoals: GoalOverview["goals"] = [];
  for (const goal of goals ?? []) {
    const designs: GoalOverview["goals"][number]["designs"] = [];
    for (const design of goal.designs) {
      const taskPaths = [...new Set(design.taskPaths ?? [])];
      associated.add(design.path); taskPaths.forEach((path) => associated.add(path));
      const source = await read(design.path);
      const taskSources = await Promise.all(taskPaths.map(read));
      const tasks = taskSources.flatMap((entry) => entry.tasks);
      const acceptance = design.acceptance.map((item) => ({
        ...item,
        supported: item.complete && acceptanceHasCurrentEvidence(item.evidenceIds, evidence),
        evidence: item.evidenceIds.map((id) => {
          const ref = evidence.references.find((entry) => entry.id === id);
          return { id, locator: ref?.locator ?? "", summary: ref?.summary ?? "证据未找到", observedAt: ref?.observedAt ?? "" };
        }),
      }));
      const parents = "parents" in design ? design.parents : null;
      const progress = ("progress" in design ? design.progress : []).map(record => ({
        ...record,
        verification: historicalVerification.filter(v => v.id && record.evidenceIds.includes(v.id)).map(v => ({
          ...v, current: !!evidence.verification?.some(current => current.id === v.id && current.freshness === "current"),
        })),
      }));
      designs.push({ ...design, parents, progress, source, taskSources, acceptance,
        taskProgress: { completed: tasks.filter((task) => task.checked).length, total: tasks.length },
        mark: { completed: acceptance.filter((item) => item.supported).length, total: acceptance.length },
      });
    }
    viewGoals.push({ ...goal, designs });
  }
  const discovery = await discoverSources(root);
  const principles = (await Promise.all(PRINCIPLE_PATHS.map(read))).filter((entry) => entry.status !== "missing");
  const unassociated = await Promise.all(discovery.paths.filter((path) => !associated.has(path)).map(read));
  const warnings = discovery.truncated ? ["原始产物发现已达到扫描上限；可在 goals 中显式引用其余文件。"] : [];
  if ([...sources.values()].length && (await Promise.all(sources.values())).some((entry) => entry.truncated)) warnings.push("部分原文超过 64 KiB，预览和任务统计仅覆盖已读取部分。");
  const goalOriginCurrent = projectGoal ? [projectGoal.philosophy, projectGoal.market].every(origin =>
    principles.some(source => source.path === origin.path && source.evidenceId === origin.evidenceId)) : false;
  return { projectGoal, goalOriginCurrent, goals: viewGoals, principles, unassociated, warnings };
}
