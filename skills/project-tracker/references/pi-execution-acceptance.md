# Pi execution and explicit acceptance

Executing a task and accepting a design are different claims. A real single-shot
`pi -p` run in a worktree produces **execution evidence**: output and exit
status. That evidence does not, by itself, complete any design.

To accept a design criterion:

1. Run the project's allowlisted verification on the final target project, not in
   another worktree. Evidence bound to another worktree cannot establish this
   target's acceptance.
2. Associate each acceptance criterion with evidence that actually tests it.
3. Apply the change through reviewed State refresh. Page 0 then displays the
   evidence-supported Design Mark.

Keep unsupported criteria incomplete even when all tasks are checked. A saved
record, completed task, commit, merge or execution event proves execution, not
acceptance. Do not claim same-session follow-up or resume unless it was actually
verified.
