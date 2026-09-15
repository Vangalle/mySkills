# Local installation and optional CodeGraph

The source checkout contains exactly two skills: `skill/project-tracker` and
`skill/codegraph`. The default installer installs only Project Tracker and an
absolute launcher for its already-built local CLI, plus a local Pi input extension
that waits for project scanning. It does not install CodeGraph, Pi, a task board,
or global npm packages.

From the Tracker source checkout, with its dependencies and `dist/cli.js` built:

```sh
node scripts/install-skill.mjs
```

Defaults: `~/.pi/agent/skills/project-tracker`,
`~/.pi/agent/extensions/project-tracker/index.ts`, and `~/.local/bin/project-tracker`.
Run `/reload` in Pi or start a new session after installation. Disabling extensions
or loading only the skill text does not provide the programmatic scan gate. If the bin directory is outside PATH, invoke the
absolute launcher or tell the user to add the directory to PATH; do not edit
shell configuration automatically. Keep the source checkout at its installed
location. After source changes, rebuild before using the launcher.

The installed skill's `.project-tracker-source.json` records `source`,
`installer`, and CLI path. A legacy marker has only `source`: its parent directory
is `skill`, whose parent is the Tracker checkout. Read that marker to locate the
installer; do not assume the user's current project is the Tracker source.
The repository copy can use its own checkout directly.

## CodeGraph approval

Ask only when preparing to use graph indexing or graph context queries
(`map index` / `map context`) and the selected runtime is absent or incomplete.
Ordinary scan, refresh, dashboard, `map inspect`, and file/search work do not
trigger installation offers. A decline or unanswered offer means use Map hints
and file/search fallback for the current task without asking again. A later task
that actually needs graph functionality may ask again.

For that graph operation, run `project-tracker map inspect [path]` first. The
`codegraph` capability reports
the exact selected runtime directory and availability. Default runtime:
`~/.local/share/project-tracker/codegraph`; `PROJECT_TRACKER_CODEGRAPH_DIR`
overrides it. A custom path must also be set in the environment of subsequent
Tracker commands. Resolve the actual paths before presenting the choice.

Ask in concrete terms: “May I install the optional CodeGraph 1.6.0 skill to
`~/.pi/agent/skills/codegraph` and its local npm runtime to
`~/.local/share/project-tracker/codegraph`? This downloads its pinned dependency
packages and runs their installation scripts. Tracker works without it.” Include
the resolved installer command for review. Do not use the confirmation flag until
the user explicitly approves this optional installation.

Only after approval, from the source checkout:

```sh
node scripts/install-skill.mjs --skill codegraph --confirm-codegraph
```

This installs the addon skill and locked runtime together. It leaves Tracker's
core package and CLI alone. Installation does not index any project; use an
explicit `map index` next if the user requested code navigation. There is no
implicit `npx`, latest-version, root dependency, or cached-global fallback.

For isolated installation use `--skills-dir <dir>`, `--bin-dir <dir>`,
`--extensions-dir <dir>`, and `--runtime-dir <dir>` (the latter overrides the runtime
environment variable). By default the extensions directory is the `extensions`
sibling of the selected skills directory.
For removal use the same paths and `--uninstall`; add `--skill codegraph` to
remove only the addon skill and its owned runtime. The installer refuses to
replace or remove foreign skills, commands, extensions or runtime directories.
Newly installed skill files and the generated extension are hash-protected against
local edits. Legacy skill markers without hashes remain eligible for same-source
upgrade. Same-source upgrades are staged and restored on failure.
