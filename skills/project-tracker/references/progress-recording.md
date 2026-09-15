# Automatic development records

## Two authorities, not one approval funnel

Routine observations append automatically to an **existing** feature goal/design.
Goal, source, design/parent, criterion and acceptance changes require diagram review
and the separate refresh path. `state record` cannot make those changes. It is a
scoped CLI writer, not a background watcher or a guarantee that every AI will
remember to invoke it.

## During development

1. Use the prepared **target project root**, current State v2, and explicit goal /
   design IDs. State v1 or incompatible files use the [onboarding flow](onboarding.md)
   first, including an explicit backup choice for replacement. Missing design or ambiguous
   association: ask a targeted question; do not create or guess one to unblock an
   append. Leave real State untouched until that definition is established.
   Missing verificationAllowlist is not an append blocker: record unverified facts
   as unverified without running checks or forcing check configuration.
2. At a meaningful implementation step, decision, blocker, verification result or
   handoff, make one concise record: what changed, observed result, remaining gap.
   Record failed/skipped checks honestly. Git helps recover omitted observations;
   it neither supplies logical parent links nor proves success. Do not wait until
   the final summary or ask for routine append permission.
3. Use an ID once per observation (e.g. `record-session-checkpoint`), an actual
   ISO timestamp, and real evidence IDs from the current scan. Use concrete commit
   hashes, not mutable branch names, for `gitRefs`. Do not invent a verification ID
   from a process exit or call an earlier PASS current. Narrative observations may
   have empty evidence lists, but must not claim tested behavior without evidence.
4. Write an input file under the target's operational directory, **not State**:

   ```json
   {
     "goalId": "existing-feature-id",
     "designId": "existing-design-id",
     "record": {
       "id": "record-session-checkpoint",
       "recordedAt": "2026-09-14T12:00:00Z",
       "text": "修复了错误提示；检查仍失败，继续定位。",
       "evidenceIds": [],
       "gitRefs": []
     }
   }
   ```

   Values above are examples, not reusable IDs/timestamps or evidence.

5. Run immediately, without another confirmation:

   ```sh
   project-tracker state record --record "/target/.project-tracker/record.json" "/target"
   ```

   The CLI collects fresh evidence, validates the existing design, snapshots any
   referenced verification with its original binding, and writes atomically.
   Identical retries are no-ops; a reused ID with changed content is an error.
   Only report “saved” after success. For a conflict, rescan/re-read; do not remove
   someone else's lock, overwrite State or switch to direct file editing. A record
   cannot raise acceptance or update baseline freshness.
6. Continue development. At handoff, record the remaining gap before reporting.
   Page 0 shows persisted history on reload; it remains read-only. Historical PASS
   stays historical unless the current relevant evidence supports the criterion.

For Pi worktrees, bind records and verification to their actual project. Do not
use another worktree's verification IDs in target acceptance. After integration,
verify the intended target and append its observed result there. This guide does
not introduce automatic cross-worktree State merging or a second task store.
