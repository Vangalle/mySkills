---
name: writing-technical-reports
description: Use when writing a substantial Chinese technical or scientific report from supplied material for readers in the broader field
---

# Write Technical Report

## Goal

Write a substantial Chinese technical or scientific report that describes and analyzes supplied material systematically, rigorously, and accessibly. Preserve necessary depth; concision means removing waste, not making the report short.

## Default Structure

Use this outline by default:

1. **Abstract:** scope, approach, main findings, and significance.
2. **Introduction:** problem, motivation, objectives or contributions, and roadmap.
3. **Background and Related Work:** definitions, theory, assumptions, and available prior context. Keep these combined by default; do not invent related work to fill the section.
4. **Methodology or Technical Approach:** model, system, mechanism, procedure, or setup.
5. **Results or Evaluation:** observations, evidence, comparisons, measurements, or derived findings.
6. **Discussion:** interpretation, implications, limitations, and uncertainty.
7. **Conclusion:** synthesis supported by the report.

This is a strong default, not a rigid template. Merge, rename, omit, or add sections only when the task clearly requires it or the user explicitly requests it. Preserve the progression `central problem/idea → foundations → approach or mechanism → evidence or analysis → interpretation → conclusion`. Do not run a separate outline-fit check or manufacture content to complete the outline; this ban concerns outline selection, not the mandatory `structure` audit below.

## Writing Requirements

- State the overall framework, central claim, and causal or logical chain before details.
- Introduce evidence-supported necessary definitions, theorems, assumptions, settings, concepts, and notation before first substantive use.
- Explain a formula's conceptual purpose before or alongside its details; define every symbol and explain each consequential term.
- Use established domain terminology when it improves precision. Coin a term only when repeated paraphrase would materially harm clarity, and define it immediately. Assign one canonical term to each object, mechanism, process, or concept and use it throughout the report. Never vary terminology for style, novelty, or avoidance of repetition; remove every alternative label used for the same referent.
- Write for readers familiar with the general area but not the same specialty. Use plain, elegant, formal Chinese and consistent terminology.
- Apply Occam's razor to unnecessary concepts, assumptions, repetition, and complexity—not to necessary background, reasoning, or technical detail.
- Allocate detail by conceptual importance; minor exceptions must not overwhelm the main mechanism.

## Evidence Boundary

Treat supplied material as the default evidence boundary. Preserve available citations and distinguish source claims from deductions, explanations, assumptions, and uncertainty. Never invent facts, experiments, results, references, or causal relationships.

Before drafting, make an internal claim ledger: source fact, necessary deduction, labeled hypothesis, or authorized external claim. Do not print the ledger unless asked. For each claimed deduction, apply a counterexample test: if any plausible interpretation consistent with the source makes it false, it is not necessary; label it as a hypothesis or omit it. Do not use prior knowledge as evidence or silently supply a missing definition.

An observed association or result does not prove causation, validate a proposed mechanism, or justify generalization. Do not infer an implementation detail (such as queue count, preemption, FIFO ordering, static classification, or workload properties) from a high-level description.

Use external sources only when the user requested research or approved it through the flow below. External background sources may supplement context but must not silently replace or alter the supplied material's methods, findings, or conclusions.

## Background-Gap Permission Flow

When missing background would prevent a self-contained report and the user did not request research, ask one decision at a time:

1. In the conversation—not the report—explain the specific gap and ask only for permission to research external sources; then stop without previewing disclosure.
2. If approved, use reliable sources and cite every externally introduced claim.
3. If research is declined, separately ask whether to disclose the gap in the report.
4. If disclosure is approved, state the unresolved limitation. If declined, do not mention the gap in the report; write the best supported background available and continue.

Omitting the gap is not permission to fill it, imply it was resolved, or strengthen conclusions beyond the supplied evidence. After disclosure is declined, the report must contain no mention of any identified missing definition, source, method, result, limitation, or evidence-boundary disclaimer.

## Workflow

1. Inspect the material and identify its scope, thesis, mechanisms, evidence, and uncertainties.
2. Follow the background-gap permission flow when applicable.
3. Apply the default structure with only task-required or user-requested adjustments.
4. Draft the complete report from the overall framework toward details, but do not deliver the first draft.
5. Run the mandatory review-revision gate below. Deliver only the exact version that passes; if the third review fails, report the unresolved blockers and ask the user how to proceed instead of delivering the report.

## Mandatory Review-Revision Gate

After completing a first draft, always enter `AUDIT_REQUIRED`; never deliver the draft directly. Review the entire report against all five checks:

1. `structure`: overall framework, section roles, logical continuity, and supported conclusion.
2. `term_necessity_and_definition`: every specialized or coined term is necessary, evidence-supported where required, and defined at first use.
3. `term_referential_consistency`: each referent has one canonical term and no alternative label anywhere in the report.
4. `explanation_completeness`: definitions, symbols, formulas, mechanisms, and consequential causal or logical links are sufficiently explained.
5. `evidence_fidelity`: facts, deductions, hypotheses, uncertainty, citations, and conclusions remain within the approved evidence boundary.

Before judging terminology, inventory source terms, established domain terms, and report-created labels. Delete a report-created term unless avoiding it would materially damage clarity. For every referent with multiple candidate labels, choose one canonical term and treat every other label as forbidden. Never vary terminology for style, novelty, or repetition avoidance. A translation, symbol, or abbreviation used only to define the canonical term is not a second referential term; do not later use it independently as another name.

Create an internal review record containing the round number, `PASS` or `FAIL` for each named check, a canonical-term table, forbidden variants, and actionable issues with locations. Use the exact five check identifiers `structure`, `term_necessity_and_definition`, `term_referential_consistency`, `explanation_completeness`, and `evidence_fidelity` in the internal record and in any disclosed record; do not paraphrase or rename them. The record is internal unless the user asks to see it. Any failed check makes the whole round fail.

On failure, revise the complete report against the issue list and then review the entire report again in the next numbered round. Any issue found means the round ends immediately in overall `FAIL`; fixes made during a round never change it to `PASS`. Do not inspect only changed paragraphs: the next round must re-audit the entire revised report against all five checks from its beginning. Only a round that began from the revised full report and found zero issues may end `PASS` and `RELEASE`. Run a maximum of three review rounds. A third failed review enters `BLOCKED`: do not deliver the report; provide only the unresolved blockers and request a user decision. A passed report enters `RELEASED`. Any later content change invalidates that result and returns the report to `AUDIT_REQUIRED`.

When the loaded skill directory, a writable temporary directory, and Python 3 are available, use `scripts/review_report_gate.py`: save the draft and review JSON privately, run `start`, run `check` after each full review, and obtain the final report through `release`. Treat any malformed JSON, illegal transition, or hash mismatch as not released, and apply the result/exit-code mapping below. Output only the `report` value returned by a successful `release`, unless the user requested the review records.

The script exposes three commands, each printing one JSON object to stdout:

```text
python3 scripts/review_report_gate.py start   --draft DRAFT --state STATE
python3 scripts/review_report_gate.py check   --draft DRAFT --state STATE --review REVIEW
python3 scripts/review_report_gate.py release --draft DRAFT --state STATE
```

The review JSON has exactly these top-level keys: `schema_version` (always `1`), `verdict` (`PASS` or `FAIL`), `checks`, `canonical_terms`, and `issues`. `checks` contains exactly the five identifiers listed above, each with exactly `status` (`PASS` or `FAIL`) and `issues` (a list). Every issue has exactly `location`, `problem`, and `required_change`, all non-empty strings. Every canonical term has exactly `referent`, `canonical_term`, and `forbidden_variants` (a list). Top-level `issues` is the ordered concatenation of the five per-check `issues` lists in the identifier order above; `PASS` requires all five statuses to be `PASS` and `issues` to be empty.

Read the script's `result` and exit code on every call:

- `AUDIT_REQUIRED`, exit 0: round one is open; perform the full five-check audit next.
- `RELEASE`, exit 0: the review passed; call `release` and output only its `report` value.
- `REVISE`, exit 10: a normal failed round, not infrastructure failure. Do not switch to internal fallback. Revise the complete report against the issues, then submit a new numbered full audit.
- `BLOCKED`, exit 20: stop, report only the unresolved blockers, and ask the user how to proceed; do not deliver.
- `ERROR`, exit 2: the review JSON, state file, or invocation is malformed. Repair it and run the script again; do not deliver and do not silently switch to internal mode.

When the script cannot run because tools, filesystem access, Python 3, or the skill path is unavailable, execute the same states and five-check contract internally. Tool absence removes only the mechanical validator; it does not permit skipping review, shortening the checks, exposing the first draft, or exceeding the three-round limit.

## Final Review

Apply this checklist inside every gate audit; it does not replace or occur after the mandatory loop.

Confirm that the report is logically continuous, as self-contained as the approved evidence boundary permits, and faithful to its sources. Check that section roles remain distinct, evidence-supported symbols and specialized terms are defined, citations support the correct claims, uncertainty is preserved, and conclusions follow from the analysis.

If disclosure was declined, perform a gap scrub: for each identified gap, delete both statements that it is missing and content that fills, defines, assumes, estimates, or implies an answer to it. Keep only source-supported content and deductions that pass the counterexample test.

The following example governs wording style only: tone, diction, sentence flow, paragraph continuity, information density, and wording used to introduce terminology and formulas. It does not govern report structure or provide facts for another report.

## Style Example

长短时记忆神经网络（LSTM）由 Sepp Hochreiter 与 Jürgen Schmidhuber 于 1997 年提出，并在 2000 年由 Gers 等人进一步引入了遗忘门（Forget Gate）而获得改进。LSTM 的核心创新在于引入门控机制与细胞状态（Cell State），有效缓解了传统 RNN 在长时序建模时面临的梯度消失、梯度爆炸问题。如图 2.2 所示，LSTM 的基本架构围绕细胞状态 $\mathbf{C}_t \in \mathbb{R}^d$ 构建，其中 $d$ 表示隐藏层的维度（即隐藏状态和细胞状态的向量长度）。细胞状态作为 LSTM 的核心记忆单元，沿时间轴传递长期依赖信息，其更新规则如下：

$$
\mathbf{C}_t = \mathbf{f}_t \odot \mathbf{C}_{t-1} + \mathbf{i}_t \odot \tilde{\mathbf{C}}_t
/$$

式中 $\odot$ 表示 Hadamard 积，$\mathbf{f}_t \in [0,1]^d$ 为遗忘门（Forget Gate），用于控制前一时刻细胞状态的保留比例；$\mathbf{i}_t \in [0,1]^d$ 作为输入门（Input Gate），调节当前候选记忆细胞 $\tilde{\mathbf{C}}_t \in \mathbb{R}^d$ 的写入程度。具体而言，项 $\mathbf{f}_t \odot \mathbf{C}_{t-1}$ 通过 sigmoid 激活函数动态决定需“遗忘”的历史信息，实现选择性记忆保留；而 $\mathbf{i}_t \odot \tilde{\mathbf{C}}_t$ 将新生成的候选记忆 $\tilde{\mathbf{C}}_t$ 加权注入细胞状态，完成对当前输入相关信息的选择性整合。

