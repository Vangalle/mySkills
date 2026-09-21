/**
 * Workplane builder — authored definition + Tracker snapshot → one Plane Document.
 *
 * Everything the builder needs arrives explicitly in the two inputs. It does
 * not read files, inspect anchors on disk, run Git, or reach into a
 * verification store: those belong to Project Tracker. A check is only as
 * strong as the snapshot record that supports it.
 */
import { WorkplaneDefinitionSchema, TrackerSnapshotSchema } from "./contracts.mjs";

export const ROOT_ID = "project-goal";

/** The Project Goal is display context. `null` is legal: the project name roots the graph. */
function projectContext(tracker) {
  return {
    name: tracker.project.name,
    root: tracker.project.root,
    goalStatement: tracker.projectGoal ? tracker.projectGoal.statement : null,
  };
}

function resolveCheck(check, tracker) {
  if (check.kind === "manual") return { status: "unknown", freshness: null };
  const command = check.kind === "test" ? check.command : check.ref;
  const record = tracker.verification.find((item) => item.command === command);
  if (!record) return { status: "missing", freshness: null, command };
  if (record.result !== "PASS") return { status: "fail", freshness: record.freshness, command };
  return {
    status: record.freshness === "current" ? "pass" : "stale",
    freshness: record.freshness,
    command,
    evidenceId: record.id ?? null,
    verifiedAt: record.verifiedAt,
  };
}

function facetState(unit) {
  return {
    function: unit.function.does.trim().length > 0,
    boundary: unit.function.inScope.length > 0 && unit.function.outOfScope.length > 0,
    contract: unit.contract.provides.length + unit.contract.consumes.length > 0,
    acceptance: unit.acceptance.length > 0,
    anchors: unit.anchors.code.length + unit.anchors.docs.length + unit.anchors.map.length > 0,
    operations: unit.operations.length > 0,
  };
}

/** Self-complete = has a function, acceptance, anchors and operations. */
function isDefined(facets) {
  return facets.function && facets.acceptance && facets.anchors && facets.operations;
}

/** Controllable = the agent declared operations *and* somewhere to apply them. */
function isControllable(unit, facets) {
  return facets.operations && facets.anchors && unit.operations.includes("verify");
}

function classify(resolved) {
  const buckets = { proven: 0, stale: 0, pending: 0, failed: 0 };
  for (const item of resolved) {
    const status = item.resolved.status;
    const freshness = item.resolved.freshness;
    if (status === "pass" || (status === "present" && freshness === "current")) buckets.proven++;
    else if (status === "fail" || status === "missing") buckets.failed++;
    else if (status === "stale" || (status === "present" && freshness === "stale")) buckets.stale++;
    else buckets.pending++;
  }
  return buckets;
}

/**
 * Status is derived, never authored. `verified` requires current evidence; a
 * missing record leaves the unit partial, never verified.
 */
function deriveStatus(unit, resolved) {
  if (unit.blocked) return "blocked";
  if (resolved.length === 0) return "pending";
  const buckets = classify(resolved);
  const total = resolved.length;
  if (buckets.proven === total) return "verified";
  if (buckets.failed > 0) return "partial";
  if (buckets.proven > 0) return "partial";
  if (buckets.stale > 0) return "stale";
  return "pending";
}

/**
 * Containment tree: project root → functional groups → units. `dependsOn`
 * stays a separate cross-cutting relation; `parent` is the only containment
 * edge. Depth and ancestors feed the layered graph layout.
 */
function buildHierarchy(projectName, groups, units) {
  const errors = [];
  const byId = new Map();
  byId.set(ROOT_ID, { id: ROOT_ID, title: projectName, kind: "goal", parent: null, children: [] });
  for (const group of groups) {
    if (byId.has(group.id)) errors.push({ path: "groups", message: `duplicate hierarchy id: ${group.id}` });
    byId.set(group.id, { id: group.id, title: group.title, kind: "group", parent: group.parent ?? ROOT_ID, children: [] });
  }
  for (const unit of units) {
    if (byId.has(unit.id)) errors.push({ path: "units", message: `duplicate work unit id: ${unit.id}` });
    byId.set(unit.id, { id: unit.id, title: unit.title, kind: "unit", parent: unit.parent ?? ROOT_ID, children: [] });
  }
  for (const node of byId.values()) {
    if (node.parent !== null && !byId.has(node.parent)) {
      errors.push({ path: node.id, message: `${node.id}: unknown parent -> ${node.parent}` });
      node.parent = ROOT_ID;
    }
  }
  for (const node of byId.values()) {
    if (node.parent !== null) byId.get(node.parent).children.push(node.id);
  }
  for (const node of byId.values()) {
    const ancestors = [];
    const seen = new Set([node.id]);
    let cursor = node.parent;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push({ path: node.id, message: `hierarchy cycle involving ${node.id}` });
        break;
      }
      seen.add(cursor);
      ancestors.push(cursor);
      cursor = byId.get(cursor)?.parent ?? null;
    }
    node.ancestors = ancestors;
    node.depth = ancestors.length;
  }
  return { byId, errors };
}

/**
 * Internal tokens that must not appear unexplained in user-facing text. A token
 * is allowed only if the glossary explains it. This is the mechanical half of
 * the plain-language rule.
 */
const INTERNAL_TOKEN_PATTERNS = [
  /\brealpath\b/gi,
  /\bJSONL\b/g,
  /\bworktrees?\b/gi,
  /\bHEAD\b/g,
  /\ballowlist\b/gi,
  /\bschemas?\b/gi,
  /\bzod\b/gi,
  /\bprovenance\b/gi,
  /\bfingerprint\b/gi,
  /\bplumbing\b|\bporcelain\b/gi,
  /\bloopback\b/gi,
  /\bno-store\b/gi,
  /\biframe\b/gi,
  /\baddons?\b/gi,
  /\bstdout\b|\bstderr\b/gi,
  /\bidempotent\b/gi,
  /\bv[12]\b/gi,
  /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g,
  /\b[A-Z][A-Z0-9_]{2,}\.(?:md|toml|json)\b/g,
  /幂等|脱敏|原子写入|有界|白名单/g,
];

function userFacingStrings(definition) {
  const out = [];
  for (const unit of definition.units) {
    out.push({ where: `${unit.id} · 名称`, text: unit.title });
    out.push({ where: `${unit.id} · 功能`, text: unit.function.does });
    for (const item of unit.function.inScope) out.push({ where: `${unit.id} · 做什么`, text: item });
    for (const item of unit.function.outOfScope) out.push({ where: `${unit.id} · 不做什么`, text: item });
    for (const acceptance of unit.acceptance) out.push({ where: `${unit.id} · 完成标准 ${acceptance.id}`, text: acceptance.criterion });
    if (unit.blocked) out.push({ where: `${unit.id} · 受阻原因`, text: unit.blocked.reason });
  }
  return out;
}

function lintPlainLanguage(definition) {
  const glossary = definition.glossary
    .map((entry) => `${entry.term} ${entry.plain} ${entry.detail ?? ""}`)
    .join("\n")
    .toLowerCase();
  const errors = [];
  const warnings = [];
  const seen = new Set();
  for (const item of userFacingStrings(definition)) {
    for (const pattern of INTERNAL_TOKEN_PATTERNS) {
      for (const match of item.text.matchAll(pattern)) {
        const token = match[0];
        const key = `${item.where}|${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (glossary.includes(token.toLowerCase())) continue;
        errors.push({
          path: item.where,
          message: `${item.where}：面向用户的文字里出现内部术语“${token}”。请改成通用说法，或写进术语表并解释。`,
        });
      }
    }
  }
  for (const unit of definition.units) {
    for (const acceptance of unit.acceptance) {
      const clauses = (acceptance.criterion.match(/，/g) ?? []).length;
      if (/[；、]/.test(acceptance.criterion) || clauses >= 2) {
        warnings.push(`${unit.id} · 完成标准 ${acceptance.id}：一句里包含多个交付要点，建议拆成一条一项。`);
      }
    }
  }
  return { errors, warnings };
}

/** Iterative Kahn topological order; returns a cycle witness if one exists. */
function topoOrder(units) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const indeg = new Map();
  const outs = new Map();
  for (const unit of units) {
    indeg.set(unit.id, 0);
    outs.set(unit.id, []);
  }
  for (const unit of units) {
    for (const dep of unit.edges.dependsOn) {
      if (!byId.has(dep)) continue;
      indeg.set(unit.id, (indeg.get(unit.id) ?? 0) + 1);
      outs.get(dep).push(unit.id);
    }
  }
  const queue = [...indeg.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const sorted = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    sorted.push(id);
    for (const next of outs.get(id) ?? []) {
      const degree = indeg.get(next) - 1;
      indeg.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (sorted.length === units.length) return { sorted, cycle: [] };
  const stuck = units.map((unit) => unit.id).filter((id) => indeg.get(id) > 0);
  return { sorted, cycle: stuck.slice(0, 6) };
}

/**
 * Validate the explicit bridge. A Design reference is `{ goalId, designId }`;
 * a Work Unit reference is `unit.id`. Nothing is inferred from paths, anchors
 * or names.
 */
function indexTracker(tracker) {
  const goals = new Map();
  for (const goal of tracker.goals) {
    const designs = new Map();
    for (const design of goal.designs) designs.set(design.id, design);
    goals.set(goal.id, { goal, designs });
  }
  return goals;
}

function validateImpacts(definition, goalIndex, unitIndex) {
  const errors = [];
  const normalized = [];
  const seenRows = new Set();
  definition.designImpacts.forEach((row, i) => {
    const goalEntry = goalIndex.get(row.goalId);
    if (!goalEntry) {
      errors.push({ path: `designImpacts.${i}.goalId`, message: `unknown goal: ${row.goalId}` });
    } else if (!goalEntry.designs.has(row.designId)) {
      errors.push({ path: `designImpacts.${i}.designId`, message: `unknown design: ${row.designId}` });
    }
    const seenUnits = new Set();
    row.unitIds.forEach((unitId, j) => {
      if (!unitIndex.has(unitId)) {
        errors.push({ path: `designImpacts.${i}.unitIds.${j}`, message: `unknown work unit: ${unitId}` });
        return;
      }
      if (seenUnits.has(unitId)) {
        errors.push({ path: `designImpacts.${i}.unitIds.${j}`, message: `duplicate work unit in impact: ${unitId}` });
        return;
      }
      seenUnits.add(unitId);
    });
    const rowKey = `${row.goalId}\u0000${row.designId}`;
    if (seenRows.has(rowKey)) {
      errors.push({ path: `designImpacts.${i}`, message: `duplicate design impact: ${row.goalId}/${row.designId}` });
    }
    seenRows.add(rowKey);
    normalized.push({ goalId: row.goalId, designId: row.designId, unitIds: row.unitIds });
  });
  return { errors, normalized };
}

function buildGoals(tracker, designImpacts) {
  return tracker.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    designs: goal.designs.map((design) => {
      const unitIds = [];
      const seen = new Set();
      for (const row of designImpacts) {
        if (row.goalId !== goal.id || row.designId !== design.id) continue;
        for (const unitId of row.unitIds) {
          if (seen.has(unitId)) continue;
          seen.add(unitId);
          unitIds.push(unitId);
        }
      }
      return {
        id: design.id,
        title: design.title,
        path: design.path,
        parents: design.parents ?? null,
        progress: design.progress.map((entry) => ({
          id: entry.id,
          recordedAt: entry.recordedAt,
          text: entry.text,
          evidenceIds: entry.evidenceIds,
          gitRefs: entry.gitRefs,
        })),
        acceptance: design.acceptance.map((entry) => ({
          id: entry.id,
          criterion: entry.criterion,
          complete: entry.complete,
          evidenceIds: entry.evidenceIds,
        })),
        unitIds,
      };
    }),
  }));
}

function designsByUnit(designImpacts, goalIndex) {
  const index = new Map();
  for (const row of designImpacts) {
    const design = goalIndex.get(row.goalId)?.designs.get(row.designId);
    for (const unitId of row.unitIds) {
      if (!index.has(unitId)) index.set(unitId, []);
      const list = index.get(unitId);
      if (list.some((entry) => entry.goalId === row.goalId && entry.designId === row.designId)) continue;
      list.push({ goalId: row.goalId, designId: row.designId, title: design?.title ?? row.designId });
    }
  }
  return index;
}

export function buildPlane(rawDefinition, rawTracker, { now } = {}) {
  const definition = WorkplaneDefinitionSchema.parse(rawDefinition);
  const tracker = TrackerSnapshotSchema.parse(rawTracker);

  const errors = [];
  const warnings = [];
  const project = projectContext(tracker);
  const hierarchy = buildHierarchy(project.name, definition.groups, definition.units);
  errors.push(...hierarchy.errors);

  const plainLanguage = lintPlainLanguage(definition);
  errors.push(...plainLanguage.errors);
  warnings.push(...plainLanguage.warnings);

  const goalIndex = indexTracker(tracker);
  const unitIndex = new Map(definition.units.map((unit) => [unit.id, unit]));
  const bridge = validateImpacts(definition, goalIndex, unitIndex);
  errors.push(...bridge.errors);
  const designImpacts = bridge.normalized;
  const unitDesigns = designsByUnit(designImpacts, goalIndex);

  const ids = new Set(definition.units.map((unit) => unit.id));
  const reverse = new Map();
  for (const unit of definition.units) reverse.set(unit.id, { dependents: [] });

  const units = definition.units.map((unit) => {
    const facets = facetState(unit);
    const resolved = unit.acceptance.map((acceptance) => ({
      ...acceptance,
      resolved: resolveCheck(acceptance.check, tracker),
    }));

    if (unit.edges.dependsOn.includes(unit.id)) errors.push({ path: unit.id, message: `${unit.id}: self dependency` });
    for (const dep of unit.edges.dependsOn) {
      if (!ids.has(dep)) errors.push({ path: unit.id, message: `${unit.id}: unknown dependsOn -> ${dep}` });
      else reverse.get(dep).dependents.push(unit.id);
    }
    if (!facets.anchors) errors.push({ path: unit.id, message: `${unit.id}: 没有代码/文档锚点，agent 无法作用` });
    if (!facets.acceptance) errors.push({ path: unit.id, message: `${unit.id}: 没有验收条件，完成无法判定` });
    if (!facets.operations) errors.push({ path: unit.id, message: `${unit.id}: 没有声明操作，不可控` });
    if (!facets.boundary) warnings.push(`${unit.id}: 未声明 in/out of scope`);
    if (!facets.contract) warnings.push(`${unit.id}: 未声明 provides/consumes`);
    if (!isControllable(unit, facets)) warnings.push(`${unit.id}: 未声明 verify 操作`);
    for (const item of resolved) {
      if (item.resolved.status === "unknown") warnings.push(`${unit.id}/${item.id}: 人工验收，无法自动证明`);
    }

    const node = hierarchy.byId.get(unit.id);
    return {
      ...unit,
      relations: reverse.get(unit.id),
      designs: unitDesigns.get(unit.id) ?? [],
      parent: node?.parent ?? ROOT_ID,
      depth: node?.depth ?? 1,
      ancestors: node?.ancestors ?? [ROOT_ID],
      children: node?.children ?? [],
      facets,
      defined: isDefined(facets),
      controllable: isControllable(unit, facets),
      acceptance: resolved,
      progress: { satisfied: classify(resolved).proven, total: resolved.length },
      evidence: classify(resolved),
      status: deriveStatus(unit, resolved),
    };
  });

  const order = topoOrder(units);
  if (order.cycle.length > 0) errors.push({ path: "edges.dependsOn", message: `dependsOn cycle: ${order.cycle.join(" -> ")}` });

  const goals = buildGoals(tracker, designImpacts);

  return {
    apiVersion: "workplane/v1",
    generatedAt: now ?? new Date().toISOString(),
    project,
    context: { root: project.root, head: tracker.git.head },
    glossary: definition.glossary,
    hierarchy: {
      rootId: ROOT_ID,
      nodes: [...hierarchy.byId.values()].map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        parent: node.parent,
        depth: node.depth,
        ancestors: node.ancestors,
        children: node.children,
      })),
    },
    goals,
    designImpacts,
    units,
    coverage: {
      units: units.length,
      defined: units.filter((unit) => unit.defined).length,
      delivered: units.filter((unit) => unit.status === "verified").length,
      withEvidence: units.filter((unit) => unit.progress.satisfied > 0).length,
      orphan: units
        .filter((unit) => unit.edges.dependsOn.length === 0 && unit.relations.dependents.length === 0)
        .map((unit) => unit.id),
    },
    receipt: {
      profile: "workplane",
      errors: errors.map((entry) => entry.message),
      warnings,
      issues: errors,
      pass: errors.length === 0,
    },
  };
}
