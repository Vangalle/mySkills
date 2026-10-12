---
name: finishing-work
description: Use when a Pi agent is about to finish an execution task or hand control back after a partial result, passing checks, a blocker, or a long session, and may be leaving authorized work undone or continuing without useful progress.
---

# Finishing Work

Before the final reply, make **one brief exit decision**. This is not a new planning ceremony or a license to expand scope.

1. Re-state privately the user's requested outcome and authorization. Compare it with actual changes, verification and known gaps. A passing command, written plan, new rule, or honest disclosure of a gap is not by itself the requested outcome.
2. If a **specific, safe, authorized, worthwhile** next action directly advances that outcome, do it now; then revisit this exit decision. Prefer diagnosing a skipped acceptance path, running an available negative check, fixing a discovered defect or finishing an explicitly requested cleanup over asking the user to review your work. Do not substitute more documentation or another general checklist for the missing action. If the next action is not concrete or its evidence location is unknown, make at most one targeted discovery probe; do not guess a succession of filenames to manufacture progress.
3. Otherwise stop. The stopping reason must be one of: the requested outcome is met to the verified extent; all remaining useful work requires genuinely missing authorization, input, or a material user decision; or further investigation is speculative/low-value after a reasonable probe. State unverified limits accurately. Ask **one focused question only when its answer is needed to proceed**; otherwise close without a ceremonial approval request.

**Boundaries:** An explicit user stop wins immediately. Do not infer permission for private data, paid calls, production operations, destructive actions or scope expansion. A separate design/approval gate remains binding. Do not repeatedly re-run the same tests, chase unrelated issues, or invent work to avoid finishing. This exit decision should take less effort than the work it protects.

**Example:** A market suite says “198 passed, 96 skipped.” If test names can still be inspected safely, inspect them and identify the affected user paths before closing. If database-backed acceptance then requires an unavailable isolated environment, report that precise gap; do not call it fully verified or ask the user to read a report.
