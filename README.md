# mySkills

A public bundle of five independently maintained Agent Skills for Pi:

| Skill | Purpose |
| --- | --- |
| `explain-with-diagrams` | Make consequential task and system interpretations inspectable with Mermaid diagrams. |
| `project-tracker` | Manage project goals, design history, progress, verification evidence, and status. |
| `workplane` | Define and render an optional Work Unit graph connected to Tracker Designs. |
| `obsidian-learning` | Support structured learning and note editing in Obsidian vaults. |
| `writing-technical-reports` | Write rigorous Chinese technical and scientific reports from supplied material. |

Review skill contents before installation: skills can instruct an agent to run commands with your permissions.

## Install

Install this repository as a Pi git package:

```bash
pi install git:github.com/Vangalle/mySkills
```

Run `pi update --extension git:github.com/Vangalle/mySkills` after a new release.
The package loads all Skill documents; Project Tracker and Workplane have separate
runtime restore steps below. Run `/reload` or start a new Pi session after changes.

Alternatively, list skills through the cross-agent installer:

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

## Restore executable runtimes

Pi clones the global git package under its git checkout directory. After the install above,
locate both restore scripts deterministically with:

```bash
PI_AGENT_ROOT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
MYSKILLS_CHECKOUT="$PI_AGENT_ROOT/git/github.com/Vangalle/mySkills"
test -d "$MYSKILLS_CHECKOUT/skills"
```

### Project Tracker

The Project Tracker skill includes the minimal source needed to rebuild its CLI, dashboard, and Pi extension. Restore the complete runtime without an LLM:

```bash
bash "$MYSKILLS_CHECKOUT/skills/project-tracker/scripts/restore-project-tracker.sh" --yes
```

This deterministic command shows its destinations, runs `npm ci` (which downloads dependencies and may run their installation scripts), builds the CLI and dashboard, and invokes Project Tracker's own installer. It requires Node.js 22.5–24, npm, and rsync.

### Workplane

Workplane is independent and optional. Restore only its CLI/runtime with:

```bash
bash "$MYSKILLS_CHECKOUT/skills/workplane/scripts/restore-workplane.sh" --yes
```

It installs Workplane under its own `~/.local/share/workplane` source and
`~/.local/bin/workplane` launcher; it does not install or modify Tracker. A
project-local Pi package instead uses `.pi/git/github.com/Vangalle/mySkills` below
that project's root.

## Maintainer update

The local skill projects remain independent sources of truth. This repository only imports copies and never modifies those sources. Whenever `project-tracker` or `workplane` is selected, its required rebuild files
are imported automatically from `$HOME/Projects/project-tracker/project-tracker`
or `$HOME/Projects/project-tracker/workplane` respectively. Skill text is imported
from those source repositories, never from a potentially stale installed copy.

No LLM is involved:


```bash
npm run update-skills
npm run update-skills -- obsidian-learning
npm run update-skills -- writing-technical-reports
```

A valid update imports current local files and the Project Tracker restoration payload, runs all checks, commits the requested skill snapshots, and pushes `origin/main`. Safety checks stop on a dirty repository, wrong branch, failed validation, or remote drift.
