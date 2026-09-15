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

## Maintainer update

The local skill projects remain independent sources of truth. This repository only imports copies and never modifies those sources.

```bash
npm run update-skills
npm run update-skills -- obsidian-learning
```

A valid update imports current local files, runs all checks, commits the requested skill snapshots, and pushes `origin/main`. Safety checks stop on a dirty repository, wrong branch, failed validation, or remote drift.
