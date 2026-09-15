# mySkills Bundler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish portable snapshots of three independently maintained local skills in `Vangalle/mySkills`, with selective/all installation through `npx skills` and a safe one-command maintainer update that imports, validates, commits, and pushes.

**Architecture:** Two shell scripts separate read-only snapshot import from Git publication. `import-skills.sh` maps the three local sources and atomically refreshes bundled copies; `update-skills.sh` adds branch, cleanliness, remote-synchronization, validation, staging, commit, and push gates. Repository and isolated Git integration tests exercise real filesystem and Git behavior.

**Tech Stack:** Bash 3.2-compatible shell, rsync, Git/GitHub CLI, npm scripts, Python 3 standard-library tests, Agent Skills format, `skills` CLI 1.5.26 acceptance baseline.

## Global Constraints

- Bundle exactly `explain-with-diagrams`, `project-tracker`, and `obsidian-learning`.
- Treat all local skill sources as read-only; never move, delete, rewrite, or symlink them.
- Default sources are `$HOME/.pi/agent/skills/explain-with-diagrams`, `$HOME/.pi/agent/skills/project-tracker`, and `$HOME/Projects/skill-obsidian-learner/obsidian-learning`.
- Import current working-tree content, including uncommitted source changes.
- Exclude `.project-tracker-source.json`, `__pycache__/`, and `*.pyc` from snapshots.
- `npm run update-skills` imports all three, validates, commits, and pushes; exact skill names optionally narrow the update.
- Automatic publication requires clean `main` with `HEAD` equal to freshly fetched `origin/main`; never stash, merge, rebase, reset, or force-push.
- Keep `Vangalle/pi-copy-code`, `/Users/caleb/Projects/pi-copy-code`, and unrelated `~/.agents/skills/` content unchanged.
- Do not add a custom installer or publish an npm package.

---

## File map

- Create `.gitignore`: ignore generated Python caches and temporary import staging.
- Create `README.md`: describe the three skills and standard `npx skills` commands.
- Create `package.json`: private maintainer command surface (`test`, `import-skills`, `update-skills`).
- Create `skills/explain-with-diagrams/**`: portable snapshot of the local native Pi skill.
- Create `skills/project-tracker/**`: portable snapshot without machine installation metadata.
- Create `skills/obsidian-learning/**`: current portable snapshot, helper, and tests from the standalone local project.
- Create `scripts/import-skills.sh`: validate names/sources, stage copies, and replace bundled snapshots without writing to sources.
- Create `scripts/update-skills.sh`: enforce Git gates, invoke import and tests, create a scoped commit, and push.
- Create `tests/verify-repository.sh`: validate the committed bundle contract.
- Create `tests/test-import-skills.sh`: exercise importer behavior against disposable real directories.
- Create `tests/test-update-skills.sh`: exercise updater behavior against a disposable real Git repository and bare remote.

### Task 1: Establish the three-skill bundle contract and initial snapshots

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `package.json`
- Create: `tests/verify-repository.sh`
- Create: `skills/explain-with-diagrams/**`
- Create: `skills/project-tracker/**`
- Create: `skills/obsidian-learning/**`

**Interfaces:**
- Consumes: the three default local source directories from Global Constraints.
- Produces: `npm test`, which validates exactly three portable skill snapshots and runs the bundled `obsidian-learning` Python suite.

- [ ] **Step 1: Write the failing repository contract test**

Create `tests/verify-repository.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="$ROOT/skills"
EXPECTED=$'explain-with-diagrams\nobsidian-learning\nproject-tracker'

[[ -d "$SKILLS" ]] || { echo "missing skills directory" >&2; exit 1; }
ACTUAL="$(find "$SKILLS" -mindepth 1 -maxdepth 1 -type d \
  ! -name '.myskills-import.*' -exec basename {} \; | LC_ALL=C sort)"
[[ "$ACTUAL" == "$EXPECTED" ]] || {
  printf 'unexpected skills:\n%s\n' "$ACTUAL" >&2
  exit 1
}

for skill in explain-with-diagrams project-tracker obsidian-learning; do
  file="$SKILLS/$skill/SKILL.md"
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
  grep -q "^name: $skill$" "$file" || {
    echo "invalid name frontmatter in $file" >&2
    exit 1
  }
  grep -q '^description:' "$file" || {
    echo "missing description frontmatter in $file" >&2
    exit 1
  }
done

[[ -f "$SKILLS/explain-with-diagrams/agents/openai.yaml" ]]
[[ -f "$SKILLS/project-tracker/scripts/reporting-policy.mjs" ]]
[[ -f "$SKILLS/project-tracker/references/state-schema.md" ]]
[[ -f "$SKILLS/obsidian-learning/scripts/obsidian_learning.py" ]]
[[ -f "$SKILLS/obsidian-learning/tests/test_obsidian_learning.py" ]]

if find "$SKILLS" \( -name '.project-tracker-source.json' -o -name '__pycache__' -o -name '*.pyc' \) -print | grep -q .; then
  echo "bundle contains machine-specific or generated files" >&2
  exit 1
fi

printf 'repository bundle is valid\n'
```

Make it executable:

```bash
chmod +x tests/verify-repository.sh
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
bash tests/verify-repository.sh
```

Expected: exit nonzero with `missing skills directory`. This proves the test catches the absent bundle.

- [ ] **Step 3: Create the private maintenance package and ignore rules**

Create `.gitignore`:

```gitignore
.DS_Store
**/__pycache__/
*.pyc
skills/.myskills-import.*/
```

Create `package.json`:

```json
{
  "name": "myskills-maintainer",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "test": "bash tests/verify-repository.sh && python3 -m unittest discover -s skills/obsidian-learning/tests -p 'test_*.py'"
  }
}
```

- [ ] **Step 4: Import the initial portable snapshots manually**

Run from `/Users/caleb/Projects/mySkills`:

```bash
mkdir -p skills
rsync -a --exclude='__pycache__/' --exclude='*.pyc' \
  "$HOME/.pi/agent/skills/explain-with-diagrams/" \
  skills/explain-with-diagrams/
rsync -a --exclude='.project-tracker-source.json' \
  --exclude='__pycache__/' --exclude='*.pyc' \
  "$HOME/.pi/agent/skills/project-tracker/" \
  skills/project-tracker/
rsync -a --exclude='__pycache__/' --exclude='*.pyc' \
  "$HOME/Projects/skill-obsidian-learner/obsidian-learning/" \
  skills/obsidian-learning/
```

Do not run `mv`, `rm`, `ln`, or any installer against a source path.

- [ ] **Step 5: Write the repository README**

Create `README.md`:

````markdown
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
````

- [ ] **Step 6: Verify GREEN with repository and skill tests**

Run:

```bash
npm test
```

Expected: `repository bundle is valid`, followed by all 31 current `obsidian-learning` tests passing.

- [ ] **Step 7: Verify local Agent Skills discovery**

Run:

```bash
npx --yes skills@1.5.26 add . --list
```

Expected: output lists exactly `explain-with-diagrams`, `project-tracker`, and `obsidian-learning` as installable skills.

- [ ] **Step 8: Confirm source trees were not changed**

Run:

```bash
git -C "$HOME/Projects/skill-obsidian-learner" status --short
git -C "$HOME/Projects/pi-copy-code" status --short --branch
```

Expected: the Obsidian repository still shows its five pre-existing modified files; `pi-copy-code` remains clean on `main`.

- [ ] **Step 9: Commit the initial bundle**

```bash
git add .gitignore README.md package.json tests/verify-repository.sh skills
git commit -m "feat: bundle three Pi skills"
```

### Task 2: Implement read-only snapshot importing

**Files:**
- Create: `tests/test-import-skills.sh`
- Create: `scripts/import-skills.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: zero or more exact skill names and optional test-only environment overrides `MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE`, `MYSKILLS_PROJECT_TRACKER_SOURCE`, and `MYSKILLS_OBSIDIAN_LEARNING_SOURCE`.
- Produces: refreshed `skills/<name>/` snapshots; exit `0` on success and nonzero without source writes on invalid input or source failure.

- [ ] **Step 1: Write failing importer behavior tests**

Create executable `tests/test-import-skills.sh` that builds controlled source fixtures and a disposable copy of the repository scripts:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/myskills-import-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
mkdir -p "$REPO/scripts" "$REPO/skills" "$TMP/sources"
cp "$ROOT/scripts/import-skills.sh" "$REPO/scripts/import-skills.sh"

make_skill() {
  name="$1"
  dir="$TMP/sources/$name"
  mkdir -p "$dir"
  cat > "$dir/SKILL.md" <<EOF
---
name: $name
description: Use when testing $name imports.
---
# $name
EOF
  printf 'source-%s\n' "$name" > "$dir/value.txt"
}

snapshot() {
  dir="$1"
  (cd "$dir" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do
    shasum "$file"
  done)
}

for name in explain-with-diagrams project-tracker obsidian-learning; do
  make_skill "$name"
done
mkdir -p "$TMP/sources/project-tracker/__pycache__"
printf 'private\n' > "$TMP/sources/project-tracker/.project-tracker-source.json"
printf 'cache\n' > "$TMP/sources/project-tracker/__pycache__/cache.pyc"
printf 'bytecode\n' > "$TMP/sources/obsidian-learning/helper.pyc"

export MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE="$TMP/sources/explain-with-diagrams"
export MYSKILLS_PROJECT_TRACKER_SOURCE="$TMP/sources/project-tracker"
export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$TMP/sources/obsidian-learning"

before="$(snapshot "$TMP/sources")"
(cd "$REPO" && bash scripts/import-skills.sh)
after="$(snapshot "$TMP/sources")"
[[ "$before" == "$after" ]] || { echo 'sources changed' >&2; exit 1; }

for name in explain-with-diagrams project-tracker obsidian-learning; do
  [[ -f "$REPO/skills/$name/SKILL.md" ]]
  [[ -f "$REPO/skills/$name/value.txt" ]]
done
[[ ! -e "$REPO/skills/project-tracker/.project-tracker-source.json" ]]
[[ ! -e "$REPO/skills/project-tracker/__pycache__" ]]
[[ ! -e "$REPO/skills/obsidian-learning/helper.pyc" ]]

printf 'stale\n' > "$REPO/skills/project-tracker/stale.txt"
printf 'updated\n' > "$TMP/sources/project-tracker/value.txt"
(cd "$REPO" && bash scripts/import-skills.sh project-tracker)
[[ "$(cat "$REPO/skills/project-tracker/value.txt")" == 'updated' ]]
[[ ! -e "$REPO/skills/project-tracker/stale.txt" ]]
[[ "$(cat "$REPO/skills/obsidian-learning/value.txt")" == 'source-obsidian-learning' ]]

before_dest="$(snapshot "$REPO/skills")"
if (cd "$REPO" && bash scripts/import-skills.sh unknown-skill); then
  echo 'unknown skill unexpectedly accepted' >&2
  exit 1
fi
[[ "$before_dest" == "$(snapshot "$REPO/skills")" ]]

export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$TMP/sources/missing"
if (cd "$REPO" && bash scripts/import-skills.sh explain-with-diagrams obsidian-learning); then
  echo 'missing source unexpectedly accepted' >&2
  exit 1
fi
[[ "$before_dest" == "$(snapshot "$REPO/skills")" ]]

printf 'import behavior is valid\n'
```

Make it executable:

```bash
chmod +x tests/test-import-skills.sh
```

Production mutations caught: writing into a source changes the checksum; omitting exclusions leaves forbidden files; copying in place leaves stale files; skipping global preflight partially changes destinations; accepting arbitrary names changes the managed set.

- [ ] **Step 2: Run the importer test and verify RED**

Run:

```bash
bash tests/test-import-skills.sh
```

Expected: exit nonzero because `scripts/import-skills.sh` does not exist.

- [ ] **Step 3: Implement the minimal importer**

Create executable `scripts/import-skills.sh` with these concrete operations:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_ROOT="$ROOT/skills"
ALL_SKILLS=(explain-with-diagrams project-tracker obsidian-learning)

is_managed() {
  case "$1" in
    explain-with-diagrams|project-tracker|obsidian-learning) return 0 ;;
    *) return 1 ;;
  esac
}

source_for() {
  case "$1" in
    explain-with-diagrams)
      printf '%s\n' "${MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE:-$HOME/.pi/agent/skills/explain-with-diagrams}"
      ;;
    project-tracker)
      printf '%s\n' "${MYSKILLS_PROJECT_TRACKER_SOURCE:-$HOME/.pi/agent/skills/project-tracker}"
      ;;
    obsidian-learning)
      printf '%s\n' "${MYSKILLS_OBSIDIAN_LEARNING_SOURCE:-$HOME/Projects/skill-obsidian-learner/obsidian-learning}"
      ;;
  esac
}

if [[ "$#" -eq 0 ]]; then
  selected=("${ALL_SKILLS[@]}")
else
  selected=("$@")
fi

for skill in "${selected[@]}"; do
  is_managed "$skill" || { echo "unknown skill: $skill" >&2; exit 2; }
done

for skill in "${selected[@]}"; do
  source_dir="$(source_for "$skill")"
  [[ -d "$source_dir" && -r "$source_dir/SKILL.md" ]] || {
    echo "invalid source for $skill: $source_dir" >&2
    exit 3
  }
done

mkdir -p "$SKILLS_ROOT"
STAGE="$(mktemp -d "$SKILLS_ROOT/.myskills-import.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/new" "$STAGE/backup"

for skill in "${selected[@]}"; do
  source_dir="$(source_for "$skill")"
  mkdir -p "$STAGE/new/$skill"
  rsync -a \
    --exclude='.project-tracker-source.json' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    "$source_dir/" "$STAGE/new/$skill/"
  [[ -r "$STAGE/new/$skill/SKILL.md" ]] || {
    echo "staged snapshot missing SKILL.md: $skill" >&2
    exit 4
  }
done

replaced=()
rollback() {
  set +e
  for skill in "${replaced[@]}"; do
    rm -rf "$SKILLS_ROOT/$skill"
    if [[ -e "$STAGE/backup/$skill" ]]; then
      mv "$STAGE/backup/$skill" "$SKILLS_ROOT/$skill"
    fi
  done
}
trap 'rollback; rm -rf "$STAGE"' ERR INT TERM

for skill in "${selected[@]}"; do
  if [[ -e "$SKILLS_ROOT/$skill" ]]; then
    mv "$SKILLS_ROOT/$skill" "$STAGE/backup/$skill"
  fi
  replaced+=("$skill")
  mv "$STAGE/new/$skill" "$SKILLS_ROOT/$skill"
done

trap - ERR INT TERM
rm -rf "$STAGE"
trap - EXIT
printf 'imported: %s\n' "${selected[*]}"
```

- [ ] **Step 4: Run importer tests and verify GREEN**

Run:

```bash
bash tests/test-import-skills.sh
```

Expected: `import behavior is valid` and exit `0`.

- [ ] **Step 5: Add importer checks to the package command surface**

Update `package.json` scripts to:

```json
{
  "scripts": {
    "import-skills": "bash scripts/import-skills.sh",
    "test": "bash tests/verify-repository.sh && bash tests/test-import-skills.sh && python3 -m unittest discover -s skills/obsidian-learning/tests -p 'test_*.py'"
  }
}
```

Keep the existing `name`, `version`, and `private` fields unchanged.

- [ ] **Step 6: Run the complete suite**

Run:

```bash
npm test
```

Expected: repository validation, importer behavior, and all bundled Python tests pass.

- [ ] **Step 7: Commit the importer**

```bash
git add package.json scripts/import-skills.sh tests/test-import-skills.sh
git commit -m "feat: import local skill snapshots"
```

### Task 3: Add guarded automatic commit and push

**Files:**
- Create: `tests/test-update-skills.sh`
- Create: `scripts/update-skills.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: the same exact skill-name arguments and source environment overrides as `import-skills.sh`; a clean `main` checkout synchronized with `origin/main`.
- Produces: either a validated `chore(skills): update <names>` commit pushed to `origin/main`, or a nonzero safe abort/no-change exit without a Git history mutation.

- [ ] **Step 1: Write failing updater integration tests using real Git repositories**

Create executable `tests/test-update-skills.sh` using real temporary Git repositories and a bare remote:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/myskills-update-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
WORK="$TMP/work"
REMOTE="$TMP/origin.git"
SOURCES="$TMP/sources"

make_skill() {
  name="$1"
  mkdir -p "$SOURCES/$name"
  cat > "$SOURCES/$name/SKILL.md" <<EOF
---
name: $name
description: Use when testing $name updates.
---
# $name
EOF
  printf 'initial-%s\n' "$name" > "$SOURCES/$name/value.txt"
}

snapshot() {
  dir="$1"
  (cd "$dir" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do
    shasum "$file"
  done)
}

for name in explain-with-diagrams project-tracker obsidian-learning; do
  make_skill "$name"
done

export MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE="$SOURCES/explain-with-diagrams"
export MYSKILLS_PROJECT_TRACKER_SOURCE="$SOURCES/project-tracker"
export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$SOURCES/obsidian-learning"

mkdir -p "$WORK/scripts" "$WORK/tests"
cp "$ROOT/scripts/import-skills.sh" "$WORK/scripts/import-skills.sh"
cp "$ROOT/scripts/update-skills.sh" "$WORK/scripts/update-skills.sh"
cat > "$WORK/tests/fixture-validate.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${FAIL_VALIDATION:-0}" != 1 ]] || exit 1
for skill in explain-with-diagrams project-tracker obsidian-learning; do
  [[ -f "skills/$skill/SKILL.md" ]]
done
EOF
chmod +x "$WORK/tests/fixture-validate.sh"
cat > "$WORK/package.json" <<'EOF'
{
  "name": "myskills-update-fixture",
  "version": "0.0.0",
  "private": true,
  "scripts": {"test": "bash tests/fixture-validate.sh"}
}
EOF

(cd "$WORK" && bash scripts/import-skills.sh)
git init --bare "$REMOTE"
git -C "$WORK" init -b main
git -C "$WORK" config user.name 'mySkills Test'
git -C "$WORK" config user.email 'myskills-test@example.invalid'
git -C "$WORK" add .
git -C "$WORK" commit -m 'initial fixture'
git -C "$WORK" remote add origin "$REMOTE"
git -C "$WORK" push -u origin main
git --git-dir="$REMOTE" symbolic-ref HEAD refs/heads/main

# A selected update creates one scoped commit and pushes it.
printf 'updated-project-tracker\n' > "$SOURCES/project-tracker/value.txt"
sources_before="$(snapshot "$SOURCES")"
before="$(git -C "$WORK" rev-parse HEAD)"
(cd "$WORK" && bash scripts/update-skills.sh project-tracker)
after="$(git -C "$WORK" rev-parse HEAD)"
remote_after="$(git --git-dir="$REMOTE" rev-parse refs/heads/main)"
[[ "$before" != "$after" ]]
[[ "$after" == "$remote_after" ]]
[[ "$(git -C "$WORK" log -1 --format=%s)" == 'chore(skills): update project-tracker' ]]
[[ "$(git -C "$WORK" diff-tree --no-commit-id --name-only -r HEAD)" == 'skills/project-tracker/value.txt' ]]
[[ "$sources_before" == "$(snapshot "$SOURCES")" ]]

# No changes means no commit and no remote ref movement.
before="$after"
output="$(cd "$WORK" && bash scripts/update-skills.sh project-tracker)"
[[ "$output" == *'No skill changes to publish.'* ]]
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$before" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]

# A dirty tree aborts before importing a changed source.
printf 'unrelated\n' > "$WORK/unrelated.txt"
printf 'changed-explain\n' > "$SOURCES/explain-with-diagrams/value.txt"
bundled_before="$(cat "$WORK/skills/explain-with-diagrams/value.txt")"
if (cd "$WORK" && bash scripts/update-skills.sh explain-with-diagrams); then
  echo 'dirty tree unexpectedly accepted' >&2
  exit 1
fi
[[ "$bundled_before" == "$(cat "$WORK/skills/explain-with-diagrams/value.txt")" ]]
rm "$WORK/unrelated.txt"

# A non-main branch aborts before import.
git -C "$WORK" checkout -b topic
if (cd "$WORK" && bash scripts/update-skills.sh explain-with-diagrams); then
  echo 'wrong branch unexpectedly accepted' >&2
  exit 1
fi
[[ "$bundled_before" == "$(cat "$WORK/skills/explain-with-diagrams/value.txt")" ]]
git -C "$WORK" checkout main

# A remote-only commit causes drift and aborts before import.
git clone "$REMOTE" "$TMP/second"
git -C "$TMP/second" config user.name 'mySkills Test'
git -C "$TMP/second" config user.email 'myskills-test@example.invalid'
printf 'remote\n' > "$TMP/second/remote.txt"
git -C "$TMP/second" add remote.txt
git -C "$TMP/second" commit -m 'remote advancement'
git -C "$TMP/second" push origin main
if (cd "$WORK" && bash scripts/update-skills.sh explain-with-diagrams); then
  echo 'remote drift unexpectedly accepted' >&2
  exit 1
fi
[[ "$bundled_before" == "$(cat "$WORK/skills/explain-with-diagrams/value.txt")" ]]
git -C "$WORK" pull --ff-only

# Validation failure leaves imported files uncommitted and does not push.
printf 'validation-failure-candidate\n' > "$SOURCES/project-tracker/value.txt"
before="$(git -C "$WORK" rev-parse HEAD)"
remote_before="$(git --git-dir="$REMOTE" rev-parse refs/heads/main)"
if (cd "$WORK" && FAIL_VALIDATION=1 bash scripts/update-skills.sh project-tracker); then
  echo 'validation failure unexpectedly published' >&2
  exit 1
fi
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$remote_before" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$(cat "$WORK/skills/project-tracker/value.txt")" == 'validation-failure-candidate' ]]
[[ -n "$(git -C "$WORK" status --porcelain -- skills/project-tracker)" ]]
git -C "$WORK" reset --hard HEAD

# An invalid name never creates a commit.
before="$(git -C "$WORK" rev-parse HEAD)"
if (cd "$WORK" && bash scripts/update-skills.sh unknown-skill); then
  echo 'invalid name unexpectedly accepted' >&2
  exit 1
fi
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]

printf 'update behavior is valid\n'
```

Make it executable:

```bash
chmod +x tests/test-update-skills.sh
```

Production mutations caught: omitting any guard allows a forbidden state to advance; staging `.` includes unrelated files; skipping validation publishes a failing snapshot; unconditional commits change no-op HEAD; force/reset behavior hides remote drift.

- [ ] **Step 2: Run updater tests and verify RED**

Run:

```bash
bash tests/test-update-skills.sh
```

Expected: exit nonzero because `scripts/update-skills.sh` does not exist.

- [ ] **Step 3: Implement the guarded updater**

Create executable `scripts/update-skills.sh` with this behavior:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ALL_SKILLS=(explain-with-diagrams project-tracker obsidian-learning)

if [[ "$#" -eq 0 ]]; then
  selected=("${ALL_SKILLS[@]}")
else
  selected=("$@")
fi

for skill in "${selected[@]}"; do
  case "$skill" in
    explain-with-diagrams|project-tracker|obsidian-learning) ;;
    *) echo "unknown skill: $skill" >&2; exit 2 ;;
  esac
done

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == main ]] || { echo 'update-skills requires branch main' >&2; exit 10; }
[[ -z "$(git status --porcelain)" ]] || { echo 'update-skills requires a clean working tree' >&2; exit 11; }

git fetch origin main
remote_head="$(git rev-parse refs/remotes/origin/main)"
local_head="$(git rev-parse HEAD)"
[[ "$local_head" == "$remote_head" ]] || {
  echo 'local HEAD does not match origin/main' >&2
  exit 12
}

bash scripts/import-skills.sh "${selected[@]}"
npm test

paths=()
for skill in "${selected[@]}"; do
  paths+=("skills/$skill")
done

if [[ -z "$(git status --porcelain -- "${paths[@]}")" ]]; then
  echo 'No skill changes to publish.'
  exit 0
fi

git add -- "${paths[@]}"
if [[ -n "$(git diff --cached --name-only | grep -vE '^skills/(explain-with-diagrams|project-tracker|obsidian-learning)/' || true)" ]]; then
  echo 'refusing to commit paths outside managed skill snapshots' >&2
  exit 13
fi

names=""
for skill in "${selected[@]}"; do
  if [[ -z "$names" ]]; then names="$skill"; else names="$names,$skill"; fi
done

git commit -m "chore(skills): update $names"
git push origin main
```

The script must not use `git add .`, `git commit -a`, `--force`, `reset`, `stash`, `merge`, or `rebase`.

- [ ] **Step 4: Run updater tests and verify GREEN**

Run:

```bash
bash tests/test-update-skills.sh
```

Expected: all isolated Git scenarios pass and the temporary bare remote is removed by test cleanup.

- [ ] **Step 5: Expose the update command and run all checks**

Update `package.json` scripts to:

```json
{
  "scripts": {
    "import-skills": "bash scripts/import-skills.sh",
    "update-skills": "bash scripts/update-skills.sh",
    "test": "bash tests/verify-repository.sh && bash tests/test-import-skills.sh && bash tests/test-update-skills.sh && python3 -m unittest discover -s skills/obsidian-learning/tests -p 'test_*.py'"
  }
}
```

Run:

```bash
npm test
git diff --check
```

Expected: all shell integration tests and all bundled Python tests pass; no whitespace errors.

- [ ] **Step 6: Commit the publication workflow**

```bash
git add package.json scripts/update-skills.sh tests/test-update-skills.sh
git commit -m "feat: publish validated skill updates"
```

### Task 4: Publish and verify the real repository without altering sources

**Files:**
- No new files expected.
- Verify: complete repository, GitHub remote, temporary global Pi installs, and all four excluded local/remote boundaries.

**Interfaces:**
- Consumes: clean local `main` with Tasks 1–3 committed and the three real source directories.
- Produces: public `Vangalle/mySkills@main`, verified selective/all installation, and unchanged local source trees.

- [ ] **Step 1: Record source and excluded-repository evidence before publication**

From `/Users/caleb/Projects/mySkills`, record portable file checksums without modifying sources:

```bash
checksum_tree() {
  dir="$1"
  (cd "$dir" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do
    shasum "$file"
  done) | shasum
}
{
  checksum_tree "$HOME/.pi/agent/skills/explain-with-diagrams"
  checksum_tree "$HOME/.pi/agent/skills/project-tracker"
  checksum_tree "$HOME/Projects/skill-obsidian-learner/obsidian-learning"
} > /tmp/myskills-source-before.sha

git -C "$HOME/Projects/skill-obsidian-learner" status --porcelain=v1 \
  > /tmp/obsidian-learning-status-before.txt
git -C "$HOME/Projects/pi-copy-code" rev-parse HEAD \
  > /tmp/pi-copy-code-head-before.txt
git -C "$HOME/Projects/pi-copy-code" status --porcelain=v1 \
  > /tmp/pi-copy-code-status-before.txt
gh repo view Vangalle/pi-copy-code --json nameWithOwner,url,visibility \
  > /tmp/pi-copy-code-remote-before.json
```

Expected `pi-copy-code` HEAD: `19588edf1202c26be8f1883b25c54eddcc015c54`; expected status file: empty.

- [ ] **Step 2: Run final local verification**

```bash
npm test
npx --yes skills@1.5.26 add . --list
git diff --check
git status --short --branch
```

Expected: all tests pass; exactly three skills are listed; no diff errors; working tree clean on `main`.

- [ ] **Step 3: Push the repository's initial main branch**

```bash
git push -u origin main
```

Expected: `main` is created at `Vangalle/mySkills`, containing the design, plan, three skill snapshots, scripts, tests, and README.

- [ ] **Step 4: Exercise the real automatic no-change path**

```bash
before="$(git rev-parse HEAD)"
npm run update-skills
after="$(git rev-parse HEAD)"
[[ "$before" == "$after" ]]
```

Expected: `No skill changes to publish.` and no new local or remote commit.

- [ ] **Step 5: Verify published discovery**

```bash
npx --yes skills@1.5.26 add Vangalle/mySkills --list
```

Expected: exactly the three intended skill names and no `pi-copy-code` or unrelated skill.

- [ ] **Step 6: Verify one-skill installation in an isolated home**

```bash
ONE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/myskills-one.XXXXXX")"
HOME="$ONE_HOME" npm_config_cache="$ONE_HOME/.npm" \
  npx --yes skills@1.5.26 add Vangalle/mySkills \
  --skill obsidian-learning -g -a pi -y --copy

test -f "$ONE_HOME/.pi/agent/skills/obsidian-learning/SKILL.md"
test ! -e "$ONE_HOME/.pi/agent/skills/explain-with-diagrams"
test ! -e "$ONE_HOME/.pi/agent/skills/project-tracker"
rm -rf "$ONE_HOME"
```

Expected: only `obsidian-learning` is installed for Pi.

- [ ] **Step 7: Verify all-skills installation in another isolated home**

```bash
ALL_HOME="$(mktemp -d "${TMPDIR:-/tmp}/myskills-all.XXXXXX")"
HOME="$ALL_HOME" npm_config_cache="$ALL_HOME/.npm" \
  npx --yes skills@1.5.26 add Vangalle/mySkills \
  --skill '*' -g -a pi -y --copy

for skill in explain-with-diagrams project-tracker obsidian-learning; do
  test -f "$ALL_HOME/.pi/agent/skills/$skill/SKILL.md"
done
rm -rf "$ALL_HOME"
```

Expected: all three skills are installed for Pi.

- [ ] **Step 8: Verify GitHub contents and commit identity**

```bash
local_head="$(git rev-parse HEAD)"
remote_head="$(git ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$local_head" == "$remote_head" ]]

gh api 'repos/Vangalle/mySkills/git/trees/main?recursive=1' \
  --jq '[.tree[].path | select(test("^skills/[^/]+/SKILL.md$"))] | sort'
```

Expected paths:

```json
[
  "skills/explain-with-diagrams/SKILL.md",
  "skills/obsidian-learning/SKILL.md",
  "skills/project-tracker/SKILL.md"
]
```

- [ ] **Step 9: Prove all local sources and pi-copy-code stayed unchanged**

```bash
{
  checksum_tree "$HOME/.pi/agent/skills/explain-with-diagrams"
  checksum_tree "$HOME/.pi/agent/skills/project-tracker"
  checksum_tree "$HOME/Projects/skill-obsidian-learner/obsidian-learning"
} > /tmp/myskills-source-after.sha
cmp /tmp/myskills-source-before.sha /tmp/myskills-source-after.sha

git -C "$HOME/Projects/skill-obsidian-learner" status --porcelain=v1 \
  > /tmp/obsidian-learning-status-after.txt
cmp /tmp/obsidian-learning-status-before.txt /tmp/obsidian-learning-status-after.txt

git -C "$HOME/Projects/pi-copy-code" rev-parse HEAD \
  > /tmp/pi-copy-code-head-after.txt
cmp /tmp/pi-copy-code-head-before.txt /tmp/pi-copy-code-head-after.txt

git -C "$HOME/Projects/pi-copy-code" status --porcelain=v1 \
  > /tmp/pi-copy-code-status-after.txt
cmp /tmp/pi-copy-code-status-before.txt /tmp/pi-copy-code-status-after.txt

gh repo view Vangalle/pi-copy-code --json nameWithOwner,url,visibility \
  > /tmp/pi-copy-code-remote-after.json
cmp /tmp/pi-copy-code-remote-before.json /tmp/pi-copy-code-remote-after.json
```

Expected: every comparison succeeds. No local skill source, source-repository status, or `pi-copy-code` boundary changed.

- [ ] **Step 10: Report exact installation and maintenance commands**

Report the pushed commit and these interfaces:

```bash
npx skills add Vangalle/mySkills -g -a pi
npx skills add Vangalle/mySkills --skill '*' -g -a pi -y
npm run update-skills
npm run update-skills -- obsidian-learning
```
