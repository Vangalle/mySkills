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

Set Pi's agent root first:

```bash
PI_AGENT_ROOT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
```

If you used `pi install git:github.com/Vangalle/mySkills`, Pi cloned the global git
package under its checkout directory:

```bash
MYSKILLS_CHECKOUT="$PI_AGENT_ROOT/git/github.com/Vangalle/mySkills"
test -d "$MYSKILLS_CHECKOUT/skills"
```

If you instead used `npx skills add ... -g -a pi`, the copied skills normally live
under `$PI_AGENT_ROOT/skills`; use those paths shown below rather than
`$MYSKILLS_CHECKOUT`.

### Project Tracker

The Project Tracker skill includes the minimal source needed to rebuild its CLI, dashboard, and Pi extension. Restore the complete runtime without an LLM:

```bash
# Pi git package installation:
bash "$MYSKILLS_CHECKOUT/skills/project-tracker/scripts/restore-project-tracker.sh" --yes
# npx skills installation for Pi:
bash "$PI_AGENT_ROOT/skills/project-tracker/scripts/restore-project-tracker.sh" --yes
```

This deterministic command shows its destinations, runs `npm ci` (which downloads dependencies and may run their installation scripts), builds the CLI and dashboard, and invokes Project Tracker's own installer. It requires Node.js 22.5–24, npm, and rsync.

### Workplane

Workplane is independent and optional. Restore only its CLI/runtime with:

```bash
# Pi git package installation:
bash "$MYSKILLS_CHECKOUT/skills/workplane/scripts/restore-workplane.sh" --yes
# npx skills installation for Pi:
bash "$PI_AGENT_ROOT/skills/workplane/scripts/restore-workplane.sh" --yes
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
npm run update-skills                              # all skills, next patch tag
npm run update-skills -- obsidian-learning         # one skill, still tagged
npm run update-skills -- --bump minor workplane    # next minor tag (v0.1.0)
npm run update-skills -- --tag v1.0.0              # pin the released version
npm run update-skills -- --no-tag                  # commit without a version tag
```

A valid update imports current local files and the Project Tracker restoration
payload, runs all checks, commits the requested skill snapshots, and publishes the
commit to `origin/main` together with a new annotated version tag in one atomic
push. The tag defaults to a patch bump of the highest existing `vX.Y.Z` tag, or of
`package.json` when no tag exists yet; `--bump minor|major` moves the other digit,
and `--tag vX.Y.Z` sets the version exactly. When nothing was imported, the run
exits without a commit or a tag. Safety checks stop on a dirty repository, wrong
branch, failed validation, remote drift, or a malformed/already published tag.
`package.json` keeps its placeholder version: the git tag is the released version,
so consumers can pin one with `pi install git:github.com/Vangalle/mySkills@v1.0.0`.
