---
name: refactoring-by-boundaries
description: Use when refactoring existing code for collaboration or maintainability, especially when business rules mix with database, HTTP, frameworks, external APIs, or when a proposed SOLID/clean-architecture rewrite risks adding unnecessary layers.
---

# Refactoring by Boundaries

## Goal

Preserve observable behavior while making the next change easier to locate and safer to make. A good boundary protects a real business decision from a concrete detail; an unused interface is not a boundary worth paying for.

## Decide before editing

1. Read project rules, callers, tests and the current flow. Name the specific friction: which one change currently touches unrelated owners, or which technical decision leaks into business rules? If you cannot point to an actual cost, leave the structure alone.
2. Identify the policy (business decisions), its required capability, and the detail that supplies it. If policy currently imports a vendor SDK, DB implementation or transport type, define a **small, business-named port owned by the policy/consumer side**. The adapter implements that port; wire the concrete adapter at the composition root. Runtime calls may go outward; **source dependencies point toward the policy's contract**. Do not move a vendor-oriented interface to a new folder and call that inversion.
3. Judge the abstraction by its cost: new files/interfaces, cross-file jumps, data conversions and assumptions a teammate must learn. A pure stable calculation, a simple local helper or a boundary with no real protection needs no Service/Repository/DTO ceremony. A single production implementation can still justify a port when it isolates significant I/O or enables meaningful tests; multiple implementations are not a prerequisite.

## Safe change loop

- Establish a recoverable baseline; run the existing relevant tests and record known failures. If behavior has no reliable oracle, characterize it first (including errors, ordering, persistence and side effects). If that cannot be done for a high-risk path, stop rather than guessing.
- Choose one bounded behavior path. State the intended dependency/ownership change and what public contract must stay unchanged. Refactor in small reviewable steps, with tests before/after each step; for new behavior or a bug fix, use test-driven-development. Keep feature changes separate.
- Verify the relevant tests and project-wide checks; review the diff for changed outputs, failure modes, data compatibility, logging, order of side effects and generated files. Do not claim behavior equivalence beyond the evidence.

## Decision report

State (1) the specific friction and evidence, (2) the boundary changed or why no change is warranted, (3) proof before/after and remaining gaps, and (4) cost: number of new indirections, interfaces and files versus complexity removed. Prefer fewer concepts when the net benefit is unclear. Never invent an architecture score or equate SOLID with layers.

Inspired by established dependency inversion, behavior-preserving refactoring and deep-module design; no third-party skill text or rigid scoring reproduced.
