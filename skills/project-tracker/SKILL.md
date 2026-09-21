---
name: project-tracker
description: >-
  Use when a user explicitly asks about Project Tracker state, Goal/Design/Acceptance,
  source, parent or project-boundary definition maintenance, design history, progress
  records, verification or dashboard, or when implementing an existing Design will
  produce meaningful project progress.
  Do not use for ordinary
  read-only code explanation, search, review, or status wording unrelated to
  PROJECT_STATE.md.
---

# Project Tracker

Project Tracker connects Project Goal → Feature Goal → Design history → Progress /
Acceptance with bounded current evidence. Original design, plan and task files remain
authoritative; the dashboard is read-only.

## Route first

Choose one mode before running anything.

### Interactive Tracker operation

Use this mode only when the user explicitly requests Tracker status, State changes,
verification, dashboard, onboarding, or Design/Goal maintenance.

A loaded Pi extension supplies a fresh `project-tracker-context` receipt before the
model handles an explicit `/skill:project-tracker` request. Validate that it is for
this request and target root; never reuse an older receipt. Without that receipt,
run:

```sh
project-tracker prepare --json --onboarding "/target/project"
```

- `ready`: directly handle the requested operation. A bare explicit invocation may
  show the extension's four-action menu.
- `needs_state_setup`: follow [onboarding](references/onboarding.md); do not replace
  State or continue a deferred Tracker operation before review.
- failure/incomplete: stop the Tracker operation and report the exact boundary.

### Embedded development tracking

Use this mode when the current task implements or operationalizes an **existing
Design** and will change the project. Prepare bounded context for the actual target,
then continue the original development task. **Do not show the four-action menu and
do not turn the task into a generic project-status report.**

At a meaningful planning result, implementation step, decision, blocker,
verification result, or handoff, append one concise Progress record immediately
under the existing Feature Goal/Design. Follow
[automatic records](references/progress-recording.md); routine appends need no new
user confirmation.

If no unique existing Design owns the observation, ask only for that missing
association. Do not create or infer Goal/Design identity, ancestry, acceptance, or
source links to unblock a record. An incompatible State prevents the append but
must not silently authorize migration or overwrite.

### Not a Tracker task

Ordinary code explanation, read-only search, naming review, architecture discussion
without an approved project change, and generic uses of “status” or “progress” do
not use Tracker. Continue the user's task without scanning or showing Tracker UI.

## Two write authorities

| Change | Route |
| --- | --- |
| Existing Design observation | `project-tracker state record`; append automatically |
| Goal, source, Feature Goal, Design, parent, criterion, acceptance or boundary | [reviewed refresh](references/refresh.md); show a semantic diagram and wait |

Never edit `PROJECT_STATE.md` directly. A Progress append cannot change definitions,
baseline or acceptance. Definition review is about meaning shown in a diagram;
JSON, Markdown diffs and internal plans are safety artifacts, not user approval.

Project Goal comes only from the goal-origin documents that exist (`README.md`,
`PHILOSOPHY.md`, `MARKET.md`). `RULES.md` and `AGENTS.md` constrain work and never
derive the goal. Design parents are explicit logical history, never Git order,
file order or task dependencies. See [State contracts](references/state-schema.md).

## Optional Workplane boundary

Only consider Workplane when both conditions are already true:

1. the `workplane` CLI is available; and
2. the target root already contains `WORKPLANE.json`.

If either is false, stay silent: do not offer installation, initialization or a
Workplane update. Routine Design Progress and verification changes flow through the
Tracker snapshot and require no definition edit.

When an enabled project's current functional structure actually changes—Work Unit
identity/group, boundary, interface, dependency, anchor, operation, acceptance check,
or explicit Design impact—prepare a candidate relationship diagram. Wait for user
confirmation before the Tracker Workplane preview/apply path writes the definition.
Never derive authoritative Work Units or Design impacts from Progress, paths or names.

## Evidence and acceptance

Verification is bound to project root, HEAD and workspace content. Use only current,
criterion-specific PASS evidence for acceptance. Historical PASS remains historical;
failed/skipped checks are Progress facts worth recording. A plan, task checkbox,
record, Work Unit status, commit, merge or execution event does not accept a Design
or achieve a Goal. Read [Pi execution and acceptance](references/pi-execution-acceptance.md).

Never inspect `.env`, credential stores, secret files or arbitrary gitignored project
content to gather evidence. Tracker's own bounded `.project-tracker` artifacts may be
read only when the referenced workflow produced them. Run only configured allowlisted checks. Missing check configuration matters only
when verification is requested; follow [onboarding](references/onboarding.md) to
show observed candidates and obtain consent. It never blocks an unverified Progress
record.

## Requested operations

| Intent | Action |
| --- | --- |
| Current status | Explain fresh evidence, conflicts and freshness; do not write State |
| Save existing facts | Append Progress; route definition changes to reviewed refresh |
| Verify behavior | `project-tracker verify --json "/target"`; never guess commands |
| Open dashboard | `project-tracker dashboard --reuse "/target"`; verify project identity |

Use existing OpenSpec/Spec Kit artifacts by responsibility rather than copying them;
see [layer reuse](references/layer-reuse.md). `map inspect` is read-only. Ask about the
optional CodeGraph runtime only when the user actually needs `map index` or
`map context`; absence never blocks Tracker.

For a substantive report of task understanding, design or progress, use the available
`explain-with-diagrams` Skill and follow [reporting policy](references/reporting.md).
Never install optional components without explicit consent.
