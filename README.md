# mySkills

A public bundle of three independently maintained Agent Skills for Pi:

| Skill | Purpose |
| --- | --- |
| `explain-with-diagrams` | Make consequential task and system interpretations inspectable with Mermaid diagrams. |
| `project-tracker` | Manage project goals, design history, progress, verification evidence, and status. |
| `obsidian-learning` | Support structured learning and note editing in Obsidian vaults. |

Review skill contents before installation: skills can instruct an agent to run commands with your permissions.

## Install

List available skills:

```bash
npx skills add Vangalle/mySkills --list
```

Choose one or more interactively and install globally for Pi:

```bash
npx skills add Vangalle/mySkills -g -a pi
```

Install one named skill:

```bash
npx skills add Vangalle/mySkills --skill obsidian-learning -g -a pi
```

Install multiple named skills:

```bash
npx skills add Vangalle/mySkills \
  --skill explain-with-diagrams \
  --skill project-tracker \
  -g -a pi
```

Install all bundled skills for Pi:

```bash
npx skills add Vangalle/mySkills --skill '*' -g -a pi -y
```

Install all bundled skills for every detected agent:

```bash
npx skills add Vangalle/mySkills --all -g
```

## Restore the Project Tracker runtime

The Project Tracker skill includes the minimal source needed to rebuild its CLI, dashboard, and Pi extension. After installing the skill, restore the complete runtime without an LLM:

```bash
bash ~/.pi/agent/skills/project-tracker/scripts/restore-project-tracker.sh --yes
```

This deterministic command shows its destinations, runs `npm ci` (which downloads dependencies and may run their installation scripts), builds the CLI and dashboard, and invokes Project Tracker's own installer. It requires Node.js 22.5–24, npm, and rsync. Run `/reload` in Pi or start a new session afterward.

## Maintainer update

The local skill projects remain independent sources of truth. This repository only imports copies and never modifies those sources. Whenever `project-tracker` is selected, its required rebuild files are imported automatically from `$HOME/Projects/project-tracker/project-tracker`.

No LLM is involved:


```bash
npm run update-skills
npm run update-skills -- obsidian-learning
```

A valid update imports current local files and the Project Tracker restoration payload, runs all checks, commits the requested skill snapshots, and pushes `origin/main`. Safety checks stop on a dirty repository, wrong branch, failed validation, or remote drift.
