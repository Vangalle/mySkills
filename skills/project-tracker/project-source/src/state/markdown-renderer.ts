/**
 * PROJECT_STATE.md renderer (section 4.2 / 4.3).
 *
 * Renders a validated proposal into a fixed-section Markdown document. The
 * parser can round-trip the output exactly. Unknown human sections that were
 * present in a previous version are re-rendered under Project Notes.
 */
import type { ParsedProjectState, ProjectStateProposal, StateProposal } from "../contracts.js";
import { renderDesignState } from "./design-markdown.js";
import { escapeCell } from "./legacy-markdown-cells.js";
export { migrateLegacyState } from "./design-markdown.js";

function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())} ` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}

function formatCommit(commit: string): string {
  // Full hash is required so the parser can round-trip the baseline exactly.
  return commit;
}

export function renderStateHeader(
  proposal: ProjectStateProposal,
  options: { lastVerifiedAt?: string } = {},
): string {
  const verifiedAt = options.lastVerifiedAt ?? proposal.baseline.verifiedAt;
  const baselineLine =
    proposal.baseline.branch === null
      ? `> **Baseline:** \`detached\` / \`${formatCommit(proposal.baseline.commit)}\``
      : `> **Baseline:** \`${proposal.baseline.branch}\` / \`${formatCommit(proposal.baseline.commit)}\``;
  return [
    "> **State schema:** 1",
    `> **Last verified:** ${verifiedAt ? formatLocalDate(verifiedAt) : "unknown"}`,
    baselineLine,
    `> **Release state:** \`${proposal.releaseState}\``,
    "",
  ].join("\n");
}

function renderMilestone(proposal: ProjectStateProposal): string {
  const lines = ["## Current Milestone", ""];
  lines.push(`**Objective:** ${proposal.currentMilestone.objective}`, "");
  lines.push("Exit criteria:", "");
  for (const criterion of proposal.currentMilestone.exitCriteria) {
    lines.push(`- ${criterion}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderWorkstreams(proposal: ProjectStateProposal): string {
  const lines = ["## Workstreams", ""];
  if (proposal.workstreams.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  lines.push(
    "| Workstream | Status | Claim maturity | Stable baseline | Current gap | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const ws of proposal.workstreams) {
    lines.push(
      `| ${escapeCell(ws.name)} | \`${ws.status}\` | \`${ws.claimMaturity}\` | ${escapeCell(ws.stableBaseline)} | ${escapeCell(ws.currentGap)} | ${escapeCell(ws.evidenceIds.join(", "))} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderBoundaries(proposal: ProjectStateProposal): string {
  const lines = ["## Project Boundaries", ""];
  if (proposal.boundaries.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  lines.push("| Boundary | Evidence |", "| --- | --- |");
  for (const boundary of proposal.boundaries) {
    lines.push(
      `| ${escapeCell(boundary.statement)} | ${escapeCell(boundary.evidenceIds.join(", "))} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderActiveWork(proposal: ProjectStateProposal): string {
  const lines = ["## Active Work", ""];
  if (proposal.activeWork.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  for (const item of proposal.activeWork) {
    lines.push(`### ${item.name} — \`${item.status}\``, "");
    const block = (label: string, items: string[]) => {
      lines.push(`- **${label}:**`);
      if (items.length === 0) {
        lines.push("  - _none_");
      } else {
        for (const entry of items) lines.push(`  - ${entry}`);
      }
    };
    block("Completed", item.completed);
    block("Remaining", item.remaining);
    block("Definition of done", item.definitionOfDone);
    lines.push(`- **Evidence:** ${item.evidenceIds.join(", ")}`, "");
  }
  return lines.join("\n");
}

function renderRisks(proposal: ProjectStateProposal): string {
  const lines = ["## Risks", ""];
  if (proposal.risks.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  lines.push("| Severity | Problem | Impact | Next action | Evidence |", "| --- | --- | --- | --- | --- |");
  for (const risk of proposal.risks) {
    lines.push(
      `| \`${risk.severity}\` | ${escapeCell(risk.problem)} | ${escapeCell(risk.impact)} | ${escapeCell(risk.nextAction)} | ${escapeCell(risk.evidenceIds.join(", "))} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderVerification(proposal: ProjectStateProposal): string {
  const lines = ["## Verification", ""];
  if (proposal.verification.length === 0) {
    lines.push("_No verification records yet._", "");
    return lines.join("\n");
  }
  lines.push("| Command | Result | Verified at | Summary |", "| --- | --- | --- | --- |");
  for (const record of proposal.verification) {
    lines.push(
      `| \`${escapeCell(record.command)}\` | ${record.result} | ${record.verifiedAt} | ${escapeCell(record.outputSummary)} |`,
    );
  }
  // Optional backward-compatible metadata preserves IDs, bindings and exact
  // outcomes that the original v1 display table never stored.
  lines.push("", "```json", JSON.stringify(proposal.verification, null, 2), "```", "");
  return lines.join("\n");
}

function renderNextActions(proposal: ProjectStateProposal): string {
  const lines = ["## Next Actions", ""];
  if (proposal.nextActions.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  for (const action of proposal.nextActions) {
    lines.push(`- **${action.priority}** — ${action.action}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderReferences(proposal: ProjectStateProposal): string {
  const lines = ["## References", ""];
  if (proposal.references.length === 0) {
    lines.push("_None._", "");
    return lines.join("\n");
  }
  for (const ref of proposal.references) {
    lines.push(`- [${escapeCell(ref.label)}](${ref.path})`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderUnknownSections(state?: ParsedProjectState | null): string {
  if (!state || state.unknownSections.length === 0) return "";
  const lines = ["## Project Notes", ""];
  for (const section of state.unknownSections) {
    lines.push(`### ${section.title}`, "", section.body.replace(/\n$/, ""), "");
  }
  return lines.join("\n");
}

/**
 * Render the complete PROJECT_STATE.md content. `existing` supplies the
 * preserved unknown sections (round-trip guarantee for human content).
 */
export function renderProjectState(
  proposal: StateProposal,
  existing?: ParsedProjectState | null,
  options: { lastVerifiedAt?: string } = {},
): string {
  if (proposal.schemaVersion === 2) return renderDesignState(proposal, existing);
  const parts = [
    "# Project State",
    renderStateHeader(proposal, options),
    ["## Executive Summary", "", proposal.executiveSummary.trim()].join("\n"),
    renderMilestone(proposal),
    ...(proposal.goals === undefined ? [] : [
      ["## Goals", "", "Goals and design associations (source files remain authoritative).", "", "```json", JSON.stringify(proposal.goals, null, 2), "```"].join("\n"),
    ]),
    renderBoundaries(proposal),
    renderWorkstreams(proposal),
    renderActiveWork(proposal),
    renderRisks(proposal),
    renderVerification(proposal),
    renderNextActions(proposal),
    renderReferences(proposal),
    renderUnknownSections(existing),
  ];
  return `${parts
    .map((part) => part.replace(/\n{3,}/g, "\n\n").trim())
    .filter((part) => part.length > 0)
    .join("\n\n")}\n`;
}