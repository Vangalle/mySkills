# mySkills Repository Design

## Purpose

`Vangalle/mySkills` is a read-only bundler for three independently maintained local skills:

1. `explain-with-diagrams`
2. `project-tracker`
3. `obsidian-learning`

It imports portable snapshots into one public GitHub repository so users can install one, several, or all three through the standard `npx skills` CLI. It never moves, deletes, rewrites, or symlinks the local source skills.

`pi-copy-code`, `~/.agents/skills/` collections other than the explicit `obsidian-learning` source, and all other local skills remain outside this repository.

## Data flow and ownership

The local projects remain the source of truth. Import is strictly one-way:

```text
local skill sources (read-only)
    -> import portable copies
mySkills/skills/* snapshots
    -> validate, commit, push
Vangalle/mySkills
    -> select and install
npx skills users
```

There is no write path from `mySkills` back to any local skill source.

## Local sources

The default maintainer source mapping is:

| Bundled name | Read-only source |
| --- | --- |
| `explain-with-diagrams` | `$HOME/.pi/agent/skills/explain-with-diagrams` |
| `project-tracker` | `$HOME/.pi/agent/skills/project-tracker` |
| `obsidian-learning` | `$HOME/Projects/skill-obsidian-learner/obsidian-learning` |

Tests may override these paths through environment variables, but normal maintenance uses the defaults above. Import always reads the current working-tree content, including valid local changes that have not yet been committed in their source repositories.

## Repository structure

```text
mySkills/
├── README.md
├── package.json
├── scripts/
│   ├── import-skills.sh
│   └── update-skills.sh
├── tests/
│   ├── test-import-skills.sh
│   ├── test-update-skills.sh
│   └── verify-repository.sh
└── skills/
    ├── explain-with-diagrams/
    ├── project-tracker/
    └── obsidian-learning/
```

- `import-skills.sh` owns source mapping and snapshot synchronization.
- `update-skills.sh` owns Git safety checks, validation, commit creation, and pushing.
- Tests verify import boundaries and repository contents without writing to real local skill sources or the real GitHub remote.
- `package.json` is private maintenance tooling; it is not a published package or custom skill installer.

## Import behavior

The maintenance interface is:

```bash
# Import, validate, commit, and push all three skills
npm run update-skills

# Update one or more named skills
npm run update-skills -- obsidian-learning
npm run update-skills -- project-tracker obsidian-learning
```

No arguments means all three managed skills. Arguments must exactly match managed skill names.

The importer preflights every requested source before changing any bundled snapshot. It then prepares every new snapshot in temporary directories and replaces destinations only after all temporary copies succeed. For every requested skill, it:

1. verifies that the source is a readable directory containing `SKILL.md`;
2. copies its complete portable contents into a temporary snapshot;
3. excludes machine-specific or generated files; and
4. replaces `skills/<name>/`, thereby removing bundled files that no longer exist in the source.

The required exclusions are:

- `project-tracker/.project-tracker-source.json` because it contains absolute machine paths and installation metadata;
- every `__pycache__/` directory; and
- every `*.pyc` file.

The importer must not invoke source-project installers or write anywhere under the source paths.

## Automatic commit and push

Before importing, `update-skills.sh` requires:

- the current branch is `main`;
- the repository working tree is clean;
- `origin/main` exists; and
- local `HEAD` exactly matches the freshly fetched `origin/main`.

If any condition fails, it exits without importing, committing, or pushing. It never stashes, rebases, merges, resets, or force-pushes.

After import, it runs the complete repository test command. On failure, imported snapshots remain visible as uncommitted changes for inspection, but no commit or push occurs.

When validation passes:

- no changed bundled files means a successful no-op with no commit and no push;
- changed bundled files are staged only from the requested `skills/<name>/` directories;
- the generated commit message is `chore(skills): update <comma-separated names>`; and
- the new commit is pushed to `origin/main` without force.

## Installation interface

The README documents:

```bash
# List available skills
npx skills add Vangalle/mySkills --list

# Select one or more interactively for Pi
npx skills add Vangalle/mySkills -g -a pi

# Install one named skill for Pi
npx skills add Vangalle/mySkills --skill obsidian-learning -g -a pi

# Install every bundled skill for Pi
npx skills add Vangalle/mySkills --skill '*' -g -a pi -y

# Install every bundled skill for every detected agent
npx skills add Vangalle/mySkills --all -g
```

No custom installer is added. Skill selection, target-agent handling, copying, and symlinking remain responsibilities of the maintained `skills` CLI.

## Failure handling

- A missing or invalid source aborts before replacing any requested bundled snapshot.
- Import replaces destinations only after every requested temporary snapshot has been copied successfully.
- Invalid skill names are rejected without changing the bundle.
- Validation failure prevents Git history changes and network publication.
- Remote drift prevents import so local work cannot silently overwrite newer GitHub history.
- Git staging is restricted to managed skill snapshot paths.
- Local skill sources remain untouched on every success and failure path.

## Verification

Acceptance requires fresh evidence that:

1. Repository validation finds exactly the three intended skills with valid frontmatter and required supporting files.
2. Importing fixture sources copies current content, deletes stale bundled content, and excludes machine-specific and generated files.
3. Import failure leaves fixture source directories unchanged and does not partially replace a destination.
4. The update workflow commits and pushes only requested skill snapshots in an isolated temporary Git repository.
5. No-change, dirty-tree, wrong-branch, invalid-name, validation-failure, and remote-drift cases do not create or push a commit.
6. `npx skills add Vangalle/mySkills --list` discovers exactly the three published skills.
7. An isolated `npx skills` installation can install one skill without the other two.
8. The all-skills command installs all three skills for Pi.
9. Checksums and Git status confirm the three real local source trees are unchanged by import and publication.
10. `Vangalle/pi-copy-code` and its local checkout remain unchanged.
