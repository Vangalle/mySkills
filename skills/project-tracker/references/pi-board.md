# Pi board execution

Page 1 embeds the project's configured loopback `kanbanUrl`; Tracker does not
create a second task database or execute coding agents itself. Reuse the
existing board service. If absent, read `docs/open-source-page1.md` in the Tracker
source checkout (locate it through the installed source marker described in
[installation](installation.md)). That document gives the pinned public source,
license, patch, exact installation and launch commands, and validation limits.
Board dependency installation is separate from the default Tracker install.

Use the existing OpenSpec / Spec Kit design and task as the board task's source.
Give Pi the relevant paths, bounded scope, explicit existing goal/design IDs,
[automatic recording guidance](progress-recording.md), and allowlisted acceptance
command. Confirm the executor is Pi and the selected project/worktree matches the
intended target. Instruct it to save meaningful progress, failed checks and blockers
as it works, without waiting for a final summary or routine record approval.
Worktrees begin from a Git commit and do not automatically include dirty source
changes. Resolve that baseline before dispatching work dependent on those changes.

The verified path is task card → isolated worktree → one `pi -p` process →
terminal output and exit status → Review. The fixed integration disables automatic
sidebar agents and automatic prompt replay. Do not claim an attached interactive
session, Pi resume, or same-session follow-up is verified. A successful exit is
reported execution evidence, not an accepted design.

Inspect the actual output artifact in its worktree and run the project's allowed
verification there. Verify again in the final target if integrating changes;
evidence bound to another worktree cannot establish the target's acceptance.
Append the observed outcome automatically to that target's existing design;
this does not change its Design Mark. If acceptance changes, use [refresh](refresh.md)
and review the semantic change in a diagram before applying the internal preview.
Page 0 then displays the evidence-supported Design Mark. Keep unsupported criteria incomplete even when all tasks are checked.
