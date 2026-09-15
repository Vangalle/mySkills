# Automatic reporting skill

Apply this policy to a substantive user-facing report about task understanding,
design relationships, workflow, or project progress. Count the report once, not
each diagram, paragraph, tool call, retry, or subagent contribution. Routine
“still working” updates, command output, and short factual replies do not count.
The coordinating agent handles the policy for the assembled report.

## Discover and use

Check the current agent's available skills for `explain-with-diagrams`. If present,
read its SKILL.md and use it automatically without asking to install or activate
it. An explicitly supplied readable local copy can also be loaded directly.
Do not assume a skill is available from an earlier assistant claim. Follow the
skill's guidance on whether a diagram is useful; do not force a diagram for a
simple status fact.

The helper lives beside this skill, at `scripts/reporting-policy.mjs`. Resolve
its path from the loaded Tracker skill, not from the user's current directory.
Use the relevant Git project and an ID unique to this report. Reuse the ID on
retries; derive it from the task/turn when available, or generate a UUID once and
retain it for this report. With an available skill:

```sh
node <tracker-skill>/scripts/reporting-policy.mjs --project <project> --report-id <id> --skill-file <explain-with-diagrams>/SKILL.md
```

`use-skill` returns the path to read. The helper does not invoke an agent or install
anything; the reporting agent loads and follows the skill itself.

## Missing skill: every fifth report

If unavailable, omit `--skill-file`:

```sh
node <tracker-skill>/scripts/reporting-policy.mjs --project <project> --report-id <id>
```

The helper stores the count in `<project>/.project-tracker/reporting.json`, which
is operational metadata, not project acceptance evidence. It survives a new agent
session and uses the same cadence across reports for that project. On `continue`,
finish the report without an installation recommendation. On `ask-install`, ask
once for this report: “是否安装 explain-with-diagrams？它会让 Tracker 主要用
Mermaid 汇报任务理解和复杂关系。” The first offer is at report 5; later offers
are at 10, 15, and so on while missing. Do not offer again on a retry of the same
report. Available-skill reports do not consume missing-skill report counts.

An offer is not installation permission. If approved, use a verified local copy
or an available trusted skill source, state the actual destination, and follow
the host's skill installation mechanism. Do not invent a repository URL or treat
a missing source as a successful installation. Load the installed skill for the
current report when possible. If declined or unanswered, complete the report and
continue authorized work; another offer is due only after five more relevant
reports. An explicit instruction to stop recommendations overrides this cadence.

If the helper cannot safely read or write its metadata, continue the report and
briefly explain that reminder counting could not be saved. Do not reset damaged
state silently, guess that five reports elapsed, or bypass permissions to count.
CodeGraph retains its separate “ask when graph functionality is needed” policy.
