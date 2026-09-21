/** Version 2: the readable goal/design sections ARE the stored model, not a shadow JSON blob. */
import { marked, type Tokens } from "marked";
import { DesignStateProposalSchema, type DesignStateProposal, type ParsedProjectState, type ProjectStateProposal } from "../contracts.js";

function cell(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\|/g, "&#124;").replace(/\\/g, "&#92;").replace(/`/g, "&#96;")
    .replace(/\r/g, "&#13;").replace(/\n/g, "<br>").replace(/\t/g, "&#9;")
    .replace(/^ +| +$/g, s => "&#32;".repeat(s.length));
}
function uncell(value: string): string {
  return value.replace(/<br>/g, "\n").replace(/&(amp|lt|gt|#124|#92|#96|#13|#9|#32);/g,
    (_, key: string) => ({ amp: "&", lt: "<", gt: ">", "#124": "|", "#92": "\\", "#96": "`", "#13": "\r", "#9": "\t", "#32": " " })[key]!);
}
function table(headers: string[], rows: string[][]): string {
  return [headers, headers.map(() => "---"), ...rows].map(row => `| ${row.map(cell).join(" | ")} |`).join("\n");
}
function fields(values: Record<string, string>): string { return table(["Field", "Value"], Object.entries(values)); }
const json = (value: unknown) => JSON.stringify(value);
const metadata = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
const SECTIONS = new Set(["Project Goal", "Feature Goals", "Project Boundaries", "Verification", "References"]);

/** Legacy conclusions stay in the archived original under `bak/`, never in the new document. */
export function migrateLegacyState(p: ProjectStateProposal): DesignStateProposal {
  return DesignStateProposalSchema.parse({
    schemaVersion: 2, baseline: p.baseline, releaseState: p.releaseState, boundaries: p.boundaries,
    verification: p.verification, references: p.references, projectGoal: null,
    goals: (p.goals ?? []).map(goal => ({ ...goal, designs: goal.designs.map(d => ({ ...d, parents: null, progress: [] })) })),
  });
}
export function renderDesignState(p: DesignStateProposal, existing?: ParsedProjectState | null): string {
  DesignStateProposalSchema.parse(p);
  const parts = ["# Project State", ["> **State schema:** 2", `> **Last verified:** ${p.baseline.verifiedAt}`,
    `> **Baseline:** \`${cell(p.baseline.branch ?? "detached")}\` / \`${cell(p.baseline.commit)}\``,
    `> **Release state:** \`${p.releaseState}\``].join("\n"), "## Project Goal"];
  parts.push(p.projectGoal ? fields({ Established: "true", Statement: p.projectGoal.statement,
    Reasoning: p.projectGoal.reasoning }) : fields({ Established: "false" }));
  if (p.projectGoal) parts.push("### Origins",
    table(["Path", "Evidence"], p.projectGoal.origins.map(origin => [origin.path, origin.evidenceId])));
  parts.push("## Feature Goals");
  for (const goal of p.goals) {
    parts.push(`### Feature Goal: ${goal.id}`, fields({ Title: goal.title }));
    for (const d of goal.designs) {
      parts.push(`#### Design: ${d.id}`, fields({ Title: d.title, Source: d.path,
        Parents: json(d.parents), ...(d.taskPaths === undefined ? {} : { Tasks: json(d.taskPaths) }) }),
      "##### Acceptance", table(["ID", "Criterion", "Complete", "Evidence"], d.acceptance.map(a => [a.id, a.criterion, String(a.complete), json(a.evidenceIds)])), "##### Progress");
      for (const r of d.progress) parts.push(`###### Record: ${r.id}`, fields({
        "Recorded at": r.recordedAt, Text: r.text, Evidence: json(r.evidenceIds), Git: json(r.gitRefs),
      }));
    }
  }
  parts.push("## Project Boundaries", table(["Boundary", "Evidence"], p.boundaries.map(b => [b.statement, json(b.evidenceIds)])),
    "## Verification", metadata(p.verification), "## References", table(["Label", "Path"], p.references.map(r => [r.label, r.path])));
  return parts.join("\n\n") + "\n";
}
function rows(token: Tokens.Table | Tokens.Generic): string[][] {
  return (token as Tokens.Table).rows.map(row => row.map(c => uncell(c.text)));
}
function mapFields(token: Tokens.Table | Tokens.Generic): Record<string, string> {
  const entries = rows(token);
  if (entries.some(row => row.length !== 2) || new Set(entries.map(r => r[0])).size !== entries.length) throw new Error("invalid fields");
  return Object.fromEntries(entries);
}
export function parseDesignDocument(markdown: string): ParsedProjectState {
  const empty: ParsedProjectState = { schemaVersion: 2, lastVerified: null, baseline: null, releaseState: null, proposal: null, unknownSections: [] };
  let invalidReason: string | undefined;
  try {
    const header = /^> \*\*Baseline:\*\* `([^`]+)` \/ `([^`]+)`$/m.exec(markdown);
    const verifiedAt = /^> \*\*Last verified:\*\* (.+)$/m.exec(markdown)?.[1];
    const releaseState = /^> \*\*Release state:\*\* `(STABLE|ACTIVE|BLOCKED)`$/m.exec(markdown)?.[1];
    if (!header || !verifiedAt || !releaseState) {
      empty.invalidReason = "文档头部缺少 State schema、Last verified、Baseline 或 Release state。";
      return empty;
    }
    const p: DesignStateProposal = { schemaVersion: 2,
      baseline: { branch: header[1] === "detached" ? null : uncell(header[1]!), commit: uncell(header[2]!), verifiedAt },
      releaseState: releaseState as DesignStateProposal["releaseState"], projectGoal: null, goals: [], boundaries: [], verification: [], references: [] };
    const seen = new Set<string>();
    let section = "";
    let goal: DesignStateProposal["goals"][number] | undefined;
    let design: NonNullable<typeof goal>["designs"][number] | undefined;
    let record: NonNullable<typeof design>["progress"][number] | undefined;
    let sub = "";
    let unknown: { title: string; body: string } | undefined;
    const structuralTokens: string[] = [];
    const signature = (token: { type: string; raw: string }) => `${token.type}:${token.raw.trim()}`;
    for (const token of marked.lexer(markdown)) {
      if (token.type === "heading" && token.depth === 2) {
        section = token.text; goal = undefined; design = undefined; record = undefined; sub = "";
        if (seen.has(section)) throw new Error("duplicate section"); seen.add(section);
        unknown = undefined;
        if (!SECTIONS.has(section)) { unknown = { title: section, body: "" }; empty.unknownSections.push(unknown); }
        else structuralTokens.push(signature(token));
        continue;
      }
      if (unknown) { unknown.body += token.raw; continue; }
      if (token.type !== "space") structuralTokens.push(signature(token));
      if (token.type === "heading" && section === "Project Goal") sub = token.text;
      else if (token.type === "heading" && section === "Feature Goals") {
        if (token.depth === 3 && token.text.startsWith("Feature Goal: ")) {
          goal = { id: token.text.slice(14), title: "", designs: [] }; p.goals.push(goal); design = undefined; record = undefined; sub = "";
        } else if (token.depth === 4 && goal && token.text.startsWith("Design: ")) {
          design = { id: token.text.slice(8), title: "", path: "", parents: null, acceptance: [], progress: [] };
          goal.designs.push(design); record = undefined; sub = "";
        } else if (token.depth === 5 && design && ["Acceptance", "Progress"].includes(token.text)) { sub = token.text; record = undefined; }
        else if (token.depth === 6 && design && sub === "Progress" && token.text.startsWith("Record: ")) {
          record = { id: token.text.slice(8), recordedAt: "", text: "", evidenceIds: [], gitRefs: [] }; design.progress.push(record);
        } else throw new Error("unexpected history heading");
      } else if (token.type === "table") {
        if (section === "Project Goal") {
          if (sub === "Origins") {
            if (!p.projectGoal) throw new Error("origins without a goal");
            p.projectGoal.origins = rows(token).map(([path, evidenceId]) => ({ path: path!, evidenceId: evidenceId! }));
          } else {
            const f = mapFields(token);
            if (f.Philosophy !== undefined || f.Market !== undefined) {
              invalidReason = "项目目标的来源写法已更新：请在 ## Project Goal 下用 ### Origins 子表列出目标来源文档。";
              throw new Error("legacy goal origins");
            }
            if (f.Established === "true") p.projectGoal = { statement: f.Statement!, reasoning: f.Reasoning!, origins: [] };
            else if (f.Established !== "false") throw new Error("missing goal state");
            else p.projectGoal = null;
          }
        } else if (section === "Feature Goals") {
          if (record) {
            const f = mapFields(token); Object.assign(record, { recordedAt: f["Recorded at"], text: f.Text, evidenceIds: JSON.parse(f.Evidence!), gitRefs: JSON.parse(f.Git!) });
          } else if (design && sub === "Acceptance") {
            design.acceptance = rows(token).map(([id, criterion, complete, ids]) => {
              if (complete !== "true" && complete !== "false") throw new Error("invalid acceptance");
              return { id: id!, criterion: criterion!, complete: complete === "true", evidenceIds: JSON.parse(ids!) };
            });
          } else if (design) {
            const f = mapFields(token); Object.assign(design, { title: f.Title, path: f.Source, parents: JSON.parse(f.Parents!), ...(f.Tasks === undefined ? {} : { taskPaths: JSON.parse(f.Tasks) }) });
          } else if (goal) goal.title = mapFields(token).Title!;
          else throw new Error("orphan history fields");
        } else if (section === "Project Boundaries") p.boundaries = rows(token).map(([statement, ids]) => ({ statement: statement!, evidenceIds: JSON.parse(ids!) }));
        else if (section === "References") p.references = rows(token).map(([label, path]) => ({ label: label!, path: path! }));
      } else if (token.type === "code" && token.lang === "json") {
        if (section === "Verification") p.verification = JSON.parse(token.text);
      }
    }
    // The document holds current state only: any extra section means the file
    // is not canonical, and a reviewed refresh must archive it first.
    if (empty.unknownSections.length > 0) {
      empty.unknownSections = empty.unknownSections.map(n => ({ ...n, body: n.body.trim() }));
      empty.invalidReason = `文档里有不属于当前状态的章节：${empty.unknownSections.map(n => n.title).join("、")}；请把原文件归档到 bak/ 后再写新的 PROJECT_STATE.md。`;
      return empty;
    }
    if (!["Project Goal", "Feature Goals", "Verification"].every(s => seen.has(s))) {
      empty.invalidReason = "文档缺少 Project Goal、Feature Goals 或 Verification 中的某一节。";
      return empty;
    }
    const proposal = DesignStateProposalSchema.parse(p);
    // Automatic rewrite must never silently discard an extra paragraph, duplicate
    // table, unknown field or metadata block. Refuse noncanonical generated
    // sections; free-form human text belongs in preserved top-level sections.
    const canonical = marked.lexer(renderDesignState(proposal)).filter(t => t.type !== "space").map(signature);
    if (JSON.stringify(structuralTokens) !== JSON.stringify(canonical)) {
      empty.invalidReason = "生成段落与当前格式不一致：可能有手写内容或旧格式残留。";
      return empty;
    }
    return { schemaVersion: 2, lastVerified: verifiedAt, baseline: proposal.baseline, releaseState: proposal.releaseState,
      proposal, unknownSections: empty.unknownSections.map(n => ({ ...n, body: n.body.trim() })) };
  } catch {
    empty.invalidReason = invalidReason ?? "文档不是当前的标准格式，无法完整解析。";
    return empty;
  }
}
