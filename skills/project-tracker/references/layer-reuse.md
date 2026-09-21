# Reuse within each Tracker layer

Tracker owns goal lineage, logical design ancestry, progress and evidence bindings.
Upstream tools own their original governance/spec/design/task artifacts. Reuse a
function where it fits; **there is no project-wide OpenSpec-versus-Spec-Kit switch**.
Both may participate in different functions of the same project.

| Tracker layer | Reuse when present | Tracker boundary |
| --- | --- | --- |
| Constitution / User Delta | Spec Kit constitution amendment and consistency review; OpenSpec project context/rules | Update only affected documents. Philosophy + Market derive Project Goal; Rules constrain engineering. |
| Feature Goal / requirements | Spec Kit specify/clarify; OpenSpec proposal/spec delta and scenarios | Link original requirements, identify unresolved intent; do not substitute generated task lists for goals. |
| Design evolution | Spec Kit plan/research/design artifacts; OpenSpec design decisions and rationale | Record explicit logical parents under the feature goal. Artifact order or dependency edges are not ancestry. |
| Tasks / execution | Existing Spec Kit tasks; OpenSpec apply task guidance | Reference authoritative task files and use authorized Pi execution; no duplicate task engine. |
| Verification / progress | Spec Kit consistency analysis and OpenSpec verification guidance | Run current allowlisted checks; automatically append observed progress. Archive, merge and checkboxes do not establish acceptance. |

## Resolve the actual local capability

1. Inspect the project's existing authoritative artifacts and installed prompts.
   OpenSpec's Pi adapter exposes `.pi/prompts/opsx-*.md`; Spec Kit's Pi integration
   exposes `.pi/prompts/speckit.*.md`. Exact available commands vary by installed
   version: read them before use. Preserve their original sources and conventions.
2. Reuse the applicable resolved prompt/template in that layer. Do not mechanically
   execute raw upstream templates containing unresolved placeholders, shell hooks
   or commands outside the project allowlist. A prompt is not installation or
   command-execution authorization.
3. If a needed capability is absent, explain that absence. Work with the original
   project documents where possible; ask separately before optional installation.
   Never initialize a framework, add its hooks, fetch latest or fabricate a prompt
   merely to satisfy this table. No installed upstream runtime is assumed.
4. Read both relevant capabilities when both exist. Resolve conflicting ownership
   of an artifact with the user instead of copying it into competing documents.

## Audited upstream sources (not runtime requirements)

The module mapping was checked against MIT-licensed upstream source:
- OpenSpec `9d4e5974e5c0d9a09b9c6c1e1eb0975e80ec4461`:
  `schemas/spec-driven/schema.yaml`, `src/commands/workflow/instructions.ts`,
  `src/core/command-generation/adapters/pi.ts`.
- Spec Kit `fd490fac952cc6baeb421905b28031b4c5fe8a99`:
  `templates/commands/{constitution,plan,tasks,analyze}.md`,
  `src/specify_cli/integrations/pi/__init__.py`.

This package references existing capabilities; it does not vendor either framework
or claim those upstream commands have been run in an uninitialized project.
