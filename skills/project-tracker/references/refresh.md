# Reviewed definition updates

Routine progress on an existing design uses [automatic record](progress-recording.md),
not this approval path. For existing legacy/incompatible State, complete
[onboarding and backup choice](onboarding.md) before replacement. Use refresh for changed goals, design definitions/parents,
sources, criteria, acceptance, boundaries or reviewed legacy migration.

The user reviews the **semantic change in a diagram**, not JSON, Markdown previews,
raw diffs or internal execution plans. Exact previews remain an internal safety
mechanism: the written bytes must match the diagram-reviewed change.

### `/skill:project-tracker refresh`

Update PROJECT_STATE.md from evidence. All file paths below belong to the prepared
target root, never the caller's incidental cwd. Follow this flow:

1. Backend scans and emits a bounded bundle:

   ```
   mkdir -p .project-tracker
   project-tracker scan --json [path] > .project-tracker/evidence.json
   project-tracker evidence bundle [path] > .project-tracker/bundle.md
   ```

2. You (the model) read `.project-tracker/bundle.md` and produce `.project-tracker/proposal.json` matching the
   state schema in `references/state-schema.md`. Apply this evidence order:
   marked project boundaries and explicit user corrections → current
   verification/filesystem facts → Git structure → old state and assistant
   conclusions. Rules:
   - every conclusion must cite `evidenceIds` that exist in .project-tracker/evidence.json;
   - copy every `## Project boundaries` statement into proposal `boundaries`
     with its boundary evidence ID; never weaken, reverse, or omit one;
   - give every workstream a `claimMaturity`; keep status and maturity separate:
     `STABLE` can describe a stable demo, but it does not mean production;
   - a commit proves that code changed, not that behavior works or a business
     outcome happened; commit-only evidence never supports `STABLE`, and names
     such as `real-market` or `real-order` never prove real-world activity;
   - use `PRODUCTION_VERIFIED` only with direct production evidence plus an
     explicit user-confirmed production boundary; local tests, synthetic data,
     screenshots and local persistence are not production evidence;
   - never widen a local claim: a working route or subsystem does not prove the
     whole routing layer complete; qualify completed prose with its actual
     scope (`Demo 中`, `本地原型中`, etc.);
   - never invent completion: an item is only done if evidence supports it;
   - `stopReason: error|aborted` conclusions are risk evidence, never "done";
   - abandoned session branches are not current state;
   - for legacy v1 status, respect at most 3 ACTIVE items and 10 next actions;
   - for v2, derive the Project Goal only from the goal-origin documents that
     exist (`README.md`, `PHILOSOPHY.md`, `MARKET.md`); one is enough, `RULES.md`
     and `AGENTS.md` never derive it, and every origin needs its current observed
     evidence ID. Preserve explicit ancestry and all existing progress; missing
     origins remain null, unknown parents remain null;
   - for existing v1 State, `project-tracker state migrate [path]` emits a proposal
     without writing State: review its preservation and unknowns, never infer a
     Project Goal from its milestone or parents from design order;
   - reference paths are repo-relative only;
   - write all dashboard-facing proposal prose in Simplified Chinese and plain language: lead with what is working, what is wrong, why it matters, and what happens next; avoid implementation jargon, unexplained acronyms, commit-range shorthand, and schema terminology in user-facing sentences; keep machine enums and evidence IDs unchanged.

3. Backend validates and renders the diff:

   ```
   project-tracker state validate --proposal .project-tracker/proposal.json --evidence .project-tracker/evidence.json
   project-tracker state preview --proposal .project-tracker/proposal.json --evidence .project-tracker/evidence.json [path] > .project-tracker/preview.json
   ```

   Read `unifiedDiff` in the saved preview JSON; it also contains `expectedHash`
   and the exact `nextMarkdown` to apply. P0 conflicts force the release state to
   BLOCKED — never override that. The new document holds current state only, so
   any superseded section (an old `## Legacy Status`, `## Project Notes`, or any
   extra section) disappears from it. Say so explicitly: the write is only
   allowed with a backup choice, and the original is archived under `bak/`
   without overwriting an existing archive.

4. Show the changed goal/design relationships and acceptance meaning in a diagram.
   Keep unchanged context clear. **Wait for explicit confirmation of that semantic
   change, not approval of the raw diff. Never apply a definition change without it.**

5. Only after the user confirms, apply:

   ```
   project-tracker state apply --preview .project-tracker/preview.json --backup-original [path]
   ```

   If apply fails with `state_changed_since_preview`, re-run from step 1 and
   preserve newly appended records. Ask again only if the semantic change being
   approved has changed; never treat another writer's progress as disposable.
