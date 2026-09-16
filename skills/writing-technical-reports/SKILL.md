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

This is a strong default, not a rigid template. Merge, rename, omit, or add sections only when the task clearly requires it or the user explicitly requests it. Preserve the progression `central problem/idea → foundations → approach or mechanism → evidence or analysis → interpretation → conclusion`. Do not run a separate structural fit check or manufacture content to complete the outline.

## Writing Requirements

- State the overall framework, central claim, and causal or logical chain before details.
- Introduce evidence-supported necessary definitions, theorems, assumptions, settings, concepts, and notation before first substantive use.
- Explain a formula's conceptual purpose before or alongside its details; define every symbol and explain each consequential term.
- Use established domain terminology when it improves precision. Coin a term only when repeated paraphrase would materially harm clarity, and define it immediately.
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
4. Draft from the overall framework toward details.
5. Review and revise before delivering.

## Final Review

Confirm that the report is logically continuous, as self-contained as the approved evidence boundary permits, and faithful to its sources. Check that section roles remain distinct, evidence-supported symbols and specialized terms are defined, citations support the correct claims, uncertainty is preserved, and conclusions follow from the analysis.

If disclosure was declined, perform a gap scrub: for each identified gap, delete both statements that it is missing and content that fills, defines, assumes, estimates, or implies an answer to it. Keep only source-supported content and deductions that pass the counterexample test.

The following example governs wording style only: tone, diction, sentence flow, paragraph continuity, information density, and wording used to introduce terminology and formulas. It does not govern report structure or provide facts for another report.

## Style Example

长短时记忆神经网络（LSTM）由 Sepp Hochreiter 与 Jürgen Schmidhuber 于 1997 年提出，并在 2000 年由 Gers 等人进一步引入了遗忘门（Forget Gate）而获得改进。LSTM 的核心创新在于引入门控机制与细胞状态（Cell State），有效缓解了传统 RNN 在长时序建模时面临的梯度消失、梯度爆炸问题。如图 2.2 所示，LSTM 的基本架构围绕细胞状态 $\mathbf{C}_t \in \mathbb{R}^d$ 构建，其中 $d$ 表示隐藏层的维度（即隐藏状态和细胞状态的向量长度）。细胞状态作为 LSTM 的核心记忆单元，沿时间轴传递长期依赖信息，其更新规则如下：

$$
\mathbf{C}_t = \mathbf{f}_t \odot \mathbf{C}_{t-1} + \mathbf{i}_t \odot \tilde{\mathbf{C}}_t
/$$

式中 $\odot$ 表示 Hadamard 积，$\mathbf{f}_t \in [0,1]^d$ 为遗忘门（Forget Gate），用于控制前一时刻细胞状态的保留比例；$\mathbf{i}_t \in [0,1]^d$ 作为输入门（Input Gate），调节当前候选记忆细胞 $\tilde{\mathbf{C}}_t \in \mathbb{R}^d$ 的写入程度。具体而言，项 $\mathbf{f}_t \odot \mathbf{C}_{t-1}$ 通过 sigmoid 激活函数动态决定需“遗忘”的历史信息，实现选择性记忆保留；而 $\mathbf{i}_t \odot \tilde{\mathbf{C}}_t$ 将新生成的候选记忆 $\tilde{\mathbf{C}}_t$ 加权注入细胞状态，完成对当前输入相关信息的选择性整合。

