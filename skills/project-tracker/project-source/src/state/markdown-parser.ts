/**
 * PROJECT_STATE.md parser (section 4.2).
 *
 * Known sections round-trip exactly. Unknown human-authored sections are
 * preserved verbatim under Project Notes — never silently deleted. Parsing
 * never throws for unknown content.
 */
import type { ParsedProjectState, ProjectStateProposal, ReleaseState, Severity, VerificationRecord } from "../contracts.js";
import { ProjectGoalSchema, VerificationRecordSchema } from "../contracts.js";
import { marked } from "marked";
import { isValidProposal } from "./state-schema.js";
import { parseDesignDocument } from "./design-markdown.js";
import { escapeCell, unescapeCell } from "./legacy-markdown-cells.js";

export const KNOWN_SECTIONS = [
  "Goals",
  "Executive Summary",
  "Current Milestone",
  "Project Boundaries",
  "Workstreams",
  "Active Work",
  "Risks",
  "Verification",
  "Next Actions",
  "References",
] as const;

interface MarkdownSection {
  title: string;
  level: number;
  body: string;
}

export function splitSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const token of marked.lexer(markdown.replace(/\r\n/g, "\n"))) {
    if (token.type === "heading" && token.depth <= 2) {
      if (current) sections.push(current);
      current = { title: token.text, level: token.depth, body: "" };
    } else if (current) current.body += token.raw;
  }
  if (current) sections.push(current);
  return sections;
}

function parseHeaderBlock(markdown: string): {
  schemaVersion: 1;
  lastVerified: string | null;
  baseline: ParsedProjectState["baseline"];
  releaseState: ReleaseState | null;
} {
  const result = {
    schemaVersion: 1 as const,
    lastVerified: null as string | null,
    baseline: null as ParsedProjectState["baseline"],
    releaseState: null as ReleaseState | null,
  };
  // The header is the blockquote containing State schema lines.
  const headerMatches = [...markdown.matchAll(/^>\s*\*\*(.+?):\*\*\s*(.*)$/gm)];
  const fields = new Map<string, string>();
  for (const m of headerMatches) {
    fields.set(m[1]!.trim().replace(/:$/, ""), m[2]!.trim());
  }
  const stateSchema = fields.get("State schema");
  if (stateSchema && /^\d+$/.test(stateSchema)) {
    result.schemaVersion = Number(stateSchema) === 1 ? 1 : 1;
  }
  const lastVerifiedRaw = fields.get("Last verified");
  if (lastVerifiedRaw) {
    result.lastVerified = toIsoOrNull(lastVerifiedRaw);
  }
  const baselineRaw = fields.get("Baseline");
  if (baselineRaw) {
    const m = /^`([^`]+)`\s*\/\s*`([^`]+)`$/.exec(baselineRaw)
      ?? /^([^`]+?)\s+\/\s+([^`]+)$/.exec(baselineRaw);
    if (m) {
      const branch = m[1]!.trim() === "detached" ? null : m[1]!.trim();
      result.baseline = {
        branch,
        commit: m[2]!.trim(),
        verifiedAt: result.lastVerified ?? "",
      };
    }
  }
  const releaseRaw = (fields.get("Release state") ?? "").replace(/`/g, "").trim();
  if (releaseRaw === "STABLE" || releaseRaw === "ACTIVE" || releaseRaw === "BLOCKED") {
    result.releaseState = releaseRaw;
  }
  return result;
}

function toIsoOrNull(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseTableRows(body: string): string[][] {
  const rows: string[][] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split(/(?<!\\)\|/)
      .map((c) => unescapeCell(c));
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // separator
    rows.push(cells);
  }
  return rows;
}

function stripBackticks(value: string): string {
  return value.replace(/^`+/, "").replace(/`+$/, "").trim();
}

function parseProposalFromSections(sections: MarkdownSection[]): ProjectStateProposal | null {
  const structural = sections.filter(s => (KNOWN_SECTIONS as readonly string[]).includes(s.title));
  if (new Set(structural.map(s => s.title)).size !== structural.length) return null;
  const byTitle = new Map(sections.map((s) => [s.title, s]));

  const summary = byTitle.get("Executive Summary");
  const milestone = byTitle.get("Current Milestone");
  if (!summary || !milestone) return null;

  // --- executive summary
  const executiveSummary = summary.body.trim();
  if (!executiveSummary) return null;

  // --- milestone
  const objectiveMatch = /\*\*Objective:\*\*\s*(.+)/.exec(milestone.body);
  const objective = objectiveMatch ? objectiveMatch[1]!.trim() : "";
  const exitCriteria = [...milestone.body.matchAll(/^\s*-\s+(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((c) => c.length > 0);
  if (!objective || exitCriteria.length === 0) return null;

  // --- project boundaries
  const boundaries = parseTableRows(byTitle.get("Project Boundaries")?.body ?? "").slice(1).map((row) => ({
    statement: row[0] ?? "",
    evidenceIds: (row[1] ?? "").split(/\s*,\s*/).filter(Boolean),
  }));

  // --- workstreams. Legacy v1 tables had no Claim maturity column; those
  // rows are conservatively parsed as CODE_EXISTS until the next refresh.
  const workstreams = parseTableRows(byTitle.get("Workstreams")?.body ?? "").slice(1).map((row) => {
    const hasMaturityColumn = row.length >= 6;
    return {
      name: row[0] ?? "",
      status: stripBackticks(row[1] ?? "") as ProjectStateProposal["workstreams"][number]["status"],
      claimMaturity: (hasMaturityColumn
        ? stripBackticks(row[2] ?? "")
        : "CODE_EXISTS") as ProjectStateProposal["workstreams"][number]["claimMaturity"],
      stableBaseline: row[hasMaturityColumn ? 3 : 2] ?? "",
      currentGap: row[hasMaturityColumn ? 4 : 3] ?? "",
      evidenceIds: (row[hasMaturityColumn ? 5 : 4] ?? "").split(/\s*,\s*/).filter(Boolean),
    };
  });

  // --- active work (single pass over `### name — \`STATUS\`` blocks)
  const activeWork: ProjectStateProposal["activeWork"] = [];
  const activeSection = byTitle.get("Active Work");
  if (activeSection) {
    let item: ProjectStateProposal["activeWork"][number] | null = null;
    let listKey: "completed" | "remaining" | "definitionOfDone" | null = null;
    for (const line of activeSection.body.split("\n")) {
      const itemMatch = /^###\s+(.+?)\s*—\s*`(ACTIVE|BLOCKED)`\s*$/.exec(line);
      if (itemMatch) {
        item = {
          name: itemMatch[1]!.trim(),
          status: itemMatch[2] as "ACTIVE" | "BLOCKED",
          completed: [],
          remaining: [],
          definitionOfDone: [],
          evidenceIds: [],
        };
        activeWork.push(item);
        listKey = null;
        continue;
      }
      if (!item) continue;
      const blockMatch = /^- \*\*(Completed|Remaining|Definition of done|Evidence):\*\*\s*(.*)$/.exec(line);
      if (blockMatch) {
        const label = blockMatch[1]!;
        const inline = blockMatch[2]!.trim();
        if (label === "Evidence") {
          item.evidenceIds = inline.split(/\s*,\s*/).filter(Boolean);
          listKey = null;
        } else {
          listKey = label === "Completed" ? "completed" : label === "Remaining" ? "remaining" : "definitionOfDone";
          if (inline) item[listKey] = [inline];
        }
        continue;
      }
      const bulletMatch = /^  - (.+)$/.exec(line);
      if (bulletMatch && listKey) {
        const value = bulletMatch[1]!.trim();
        if (value !== "_none_") item[listKey] = [...item[listKey], value];
      }
    }
  }

  // --- risks
  const risks = parseTableRows(byTitle.get("Risks")?.body ?? "").slice(1).map((row) => ({
    severity: stripBackticks(row[0] ?? "") as Severity,
    problem: row[1] ?? "",
    impact: row[2] ?? "",
    nextAction: row[3] ?? "",
    evidenceIds: (row[4] ?? "").split(/\s*,\s*/).filter(Boolean),
  }));

  // --- verification
  let verification: VerificationRecord[] = parseTableRows(byTitle.get("Verification")?.body ?? "")
    .slice(1)
    .map((row) => ({
      command: stripBackticks(row[0] ?? ""),
      result: (row[1] ?? "").trim() as VerificationRecord["result"],
      verifiedAt: toIsoOrNull(row[2] ?? "") ?? "",
      outputSummary: row[3] ?? "",
    }))
    .filter((v) => v.command && v.result)
    .map((v) => ({ ...v, exitCode: null }));
  const metadata = marked.lexer(byTitle.get("Verification")?.body ?? "").filter(t => t.type === "code" && t.lang === "json");
  if (metadata.length > 1) return null;
  if (metadata.length) {
    try {
      const token = metadata[0]!;
      const records = VerificationRecordSchema.array().parse(JSON.parse(token.type === "code" ? token.text : ""));
      if (records.length !== verification.length || records.some((record, i) => {
        const row = verification[i]!;
        return stripBackticks(unescapeCell(escapeCell(record.command))) !== row.command || record.result !== row.result || toIsoOrNull(record.verifiedAt) !== row.verifiedAt || unescapeCell(escapeCell(record.outputSummary)) !== row.outputSummary;
      })) return null;
      verification = records;
    } catch { return null; }
  }

  // --- next actions
  const nextActions = [...((byTitle.get("Next Actions")?.body ?? "").matchAll(/^\s*-\s+\*\*(P0|P1|P2)\*\*\s*—\s*(.+)$/gm))]
    .map((m) => ({ priority: m[1] as Severity, action: m[2]!.trim() }));

  // --- references
  const references = [...((byTitle.get("References")?.body ?? "").matchAll(/^\s*-\s+\[(.+?)\]\((.+?)\)\s*$/gm))]
    .map((m) => ({ label: m[1]!.trim(), path: m[2]!.trim() }));

  const goalSection = byTitle.get("Goals");
  let goals: ProjectStateProposal["goals"];
  if (goalSection) {
    const token = marked.lexer(goalSection.body).find((entry) => entry.type === "code" && entry.lang === "json");
    try {
      const parsed = ProjectGoalSchema.array().safeParse(JSON.parse(token?.type === "code" ? token.text : "null"));
      if (!parsed.success) return null;
      goals = parsed.data;
    } catch { return null; }
  }
  const proposal: ProjectStateProposal = {
    schemaVersion: 1,
    baseline: { branch: "main", commit: "", verifiedAt: "" },
    releaseState: "ACTIVE",
    executiveSummary,
    currentMilestone: { objective, exitCriteria },
    workstreams,
    activeWork,
    risks,
    verification,
    nextActions,
    boundaries,
    references,
    ...(goals === undefined ? {} : { goals }),
  };
  return isValidProposal(proposal) ? proposal : null;
}

export function parseProjectState(markdown: string): ParsedProjectState {
  let headerText = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) break;
    if (token.type === "blockquote") headerText += token.raw;
  }
  const version = /^>\s*\*\*State schema:\*\*\s*(\d+)/m.exec(headerText)?.[1];
  if (version === "2") return parseDesignDocument(markdown);
  if (version !== undefined && version !== "1") return {
    schemaVersion: 1, lastVerified: null, baseline: null, releaseState: null, proposal: null, unknownSections: [],
  };
  const header = parseHeaderBlock(headerText);
  const sections = splitSections(markdown);
  const knownSet = new Set<string>(KNOWN_SECTIONS);
  const unknownSections: ParsedProjectState["unknownSections"] = [];

  for (const section of sections) {
    if (section.title === "Project State") {
      // The canonical document title is not an unknown human section.
      continue;
    }
    if (section.title === "Project Notes") {
      // Sub-sections of Project Notes are the preserved unknown sections.
      const subSections = splitSectionBodies(section.body);
      unknownSections.push(...subSections.map(note => ({ ...note, legacyNoteKind: "child" as const })));
      // Non-section prose is preserved as the "Project Notes" intro.
      const intro = sectionBodyWithoutSubsections(section.body);
      if (intro.trim()) {
        unknownSections.unshift({ title: "Project Notes (intro)", body: intro.trim(), legacyNoteKind: "intro" });
      }
      continue;
    }
    if (!knownSet.has(section.title) && section.level <= 2) {
      unknownSections.push({ title: section.title, body: section.body.trim() });
    }
  }

  let proposal = parseProposalFromSections(sections);
  if (proposal && header.baseline) {
    proposal = {
      ...proposal,
      baseline: { branch: header.baseline.branch, commit: header.baseline.commit, verifiedAt: header.baseline.verifiedAt || "" },
      releaseState: header.releaseState ?? proposal.releaseState,
    };
  }
  if (proposal && header.lastVerified) {
    proposal = { ...proposal, baseline: { ...proposal.baseline, verifiedAt: header.lastVerified } };
  }

  return {
    schemaVersion: header.schemaVersion,
    lastVerified: header.lastVerified,
    baseline: header.baseline,
    releaseState: header.releaseState,
    proposal,
    unknownSections,
  };
}

function splitSectionBodies(body: string): Array<{ title: string; body: string }> {
  const out: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  for (const token of marked.lexer(body)) {
    if (token.type === "heading" && token.depth === 3) {
      if (current) out.push(current);
      current = { title: token.text, body: "" };
    } else if (current) current.body += token.raw;
  }
  if (current) out.push(current);
  return out.map((s) => ({ title: s.title, body: s.body.trim() }));
}

function sectionBodyWithoutSubsections(body: string): string {
  let intro = "";
  for (const token of marked.lexer(body)) {
    if (token.type === "heading" && token.depth === 3) break;
    intro += token.raw;
  }
  return intro;
}