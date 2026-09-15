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
