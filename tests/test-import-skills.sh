#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/myskills-import-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
REPO="$TMP/repo"
PROJECT_SOURCE="$TMP/sources/project-tracker-project"
mkdir -p "$REPO/scripts" "$REPO/skills" "$REPO/templates/project-tracker" "$TMP/sources"
cp "$ROOT/scripts/import-skills.sh" "$REPO/scripts/import-skills.sh"
cp "$ROOT/templates/project-tracker/restore-project-tracker.sh" \
  "$REPO/templates/project-tracker/restore-project-tracker.sh"

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

for name in explain-with-diagrams project-tracker obsidian-learning writing-technical-reports; do
  make_skill "$name"
done
WRITING_SOURCE="$TMP/sources/writing-technical-reports"
mkdir -p "$WRITING_SOURCE/scripts" "$WRITING_SOURCE/docs" \
  "$WRITING_SOURCE/evaluations" "$WRITING_SOURCE/tests" \
  "$WRITING_SOURCE/__pycache__" "$WRITING_SOURCE/.git"
printf '#!/usr/bin/env python3\nprint("gate")\n' \
  > "$WRITING_SOURCE/scripts/review_report_gate.py"
chmod +x "$WRITING_SOURCE/scripts/review_report_gate.py"
printf 'development-only\n' > "$WRITING_SOURCE/docs/design.md"
printf 'development-only\n' > "$WRITING_SOURCE/evaluations/result.txt"
printf 'development-only\n' > "$WRITING_SOURCE/tests/test_gate.py"
printf 'cache\n' > "$WRITING_SOURCE/__pycache__/gate.pyc"
printf 'metadata\n' > "$WRITING_SOURCE/.git/config"
printf 'ignore\n' > "$WRITING_SOURCE/.gitignore"
mkdir -p "$TMP/sources/project-tracker/__pycache__"
printf 'private\n' > "$TMP/sources/project-tracker/.project-tracker-source.json"
printf 'cache\n' > "$TMP/sources/project-tracker/__pycache__/cache.pyc"
printf 'bytecode\n' > "$TMP/sources/obsidian-learning/helper.pyc"

mkdir -p "$PROJECT_SOURCE/src/pi" "$PROJECT_SOURCE/web/src" "$PROJECT_SOURCE/scripts" \
  "$PROJECT_SOURCE/tests" "$PROJECT_SOURCE/docs" "$PROJECT_SOURCE/skill/codegraph" \
  "$PROJECT_SOURCE/dist"
printf 'cli\n' > "$PROJECT_SOURCE/src/cli.ts"
printf 'extension\n' > "$PROJECT_SOURCE/src/pi/extension.ts"
printf '<div id="root"></div>\n' > "$PROJECT_SOURCE/web/index.html"
printf 'main\n' > "$PROJECT_SOURCE/web/src/main.tsx"
printf 'test\n' > "$PROJECT_SOURCE/web/src/App.test.tsx"
printf '{}\n' > "$PROJECT_SOURCE/package.json"
printf '{}\n' > "$PROJECT_SOURCE/package-lock.json"
printf '{}\n' > "$PROJECT_SOURCE/tsconfig.json"
printf 'config\n' > "$PROJECT_SOURCE/vite.config.ts"
printf '{}\n' > "$PROJECT_SOURCE/web/tsconfig.json"
printf 'config\n' > "$PROJECT_SOURCE/web/vite.config.ts"
printf 'installer\n' > "$PROJECT_SOURCE/scripts/install-skill.mjs"
printf 'forbidden\n' > "$PROJECT_SOURCE/tests/test.ts"
printf 'forbidden\n' > "$PROJECT_SOURCE/docs/design.md"
printf 'forbidden\n' > "$PROJECT_SOURCE/skill/codegraph/SKILL.md"
printf 'forbidden\n' > "$PROJECT_SOURCE/dist/cli.js"

export MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE="$TMP/sources/explain-with-diagrams"
export MYSKILLS_PROJECT_TRACKER_SOURCE="$TMP/sources/project-tracker"
export MYSKILLS_PROJECT_TRACKER_PROJECT_SOURCE="$PROJECT_SOURCE"
export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$TMP/sources/obsidian-learning"
export MYSKILLS_WRITING_TECHNICAL_REPORTS_SOURCE="$TMP/sources/writing-technical-reports"

before="$(snapshot "$TMP/sources")"
(cd "$REPO" && bash scripts/import-skills.sh)
after="$(snapshot "$TMP/sources")"
[[ "$before" == "$after" ]] || { echo 'sources changed' >&2; exit 1; }

for name in explain-with-diagrams project-tracker obsidian-learning writing-technical-reports; do
  [[ -f "$REPO/skills/$name/SKILL.md" ]] || {
    echo "missing imported skill: $name" >&2
    exit 1
  }
done
for name in explain-with-diagrams project-tracker obsidian-learning; do
  [[ -f "$REPO/skills/$name/value.txt" ]]
done
[[ ! -e "$REPO/skills/project-tracker/.project-tracker-source.json" ]]
[[ ! -e "$REPO/skills/project-tracker/__pycache__" ]]
[[ ! -e "$REPO/skills/obsidian-learning/helper.pyc" ]]

[[ -f "$REPO/skills/writing-technical-reports/value.txt" ]]
[[ -x "$REPO/skills/writing-technical-reports/scripts/review_report_gate.py" ]]
cmp -s \
  "$WRITING_SOURCE/scripts/review_report_gate.py" \
  "$REPO/skills/writing-technical-reports/scripts/review_report_gate.py"
for path in docs evaluations tests __pycache__ .git .gitignore; do
  [[ ! -e "$REPO/skills/writing-technical-reports/$path" ]] || {
    echo "unexpected writing report development path: $path" >&2
    exit 1
  }
done

PAYLOAD="$REPO/skills/project-tracker/project-source"
for path in src/cli.ts src/pi/extension.ts web/index.html web/src/main.tsx \
  web/tsconfig.json web/vite.config.ts package.json package-lock.json \
  tsconfig.json vite.config.ts scripts/install-skill.mjs; do
  [[ -f "$PAYLOAD/$path" ]] || { echo "missing payload file: $path" >&2; exit 1; }
done
[[ -x "$REPO/skills/project-tracker/scripts/restore-project-tracker.sh" ]]
for path in web/src/App.test.tsx tests/test.ts docs/design.md skill/codegraph/SKILL.md dist/cli.js; do
  [[ ! -e "$PAYLOAD/$path" ]] || { echo "unexpected payload file: $path" >&2; exit 1; }
done

printf 'stale\n' > "$REPO/skills/project-tracker/stale.txt"
printf 'stale payload\n' > "$PAYLOAD/stale.txt"
printf 'updated\n' > "$TMP/sources/project-tracker/value.txt"
(cd "$REPO" && bash scripts/import-skills.sh project-tracker)
[[ "$(cat "$REPO/skills/project-tracker/value.txt")" == 'updated' ]]
[[ ! -e "$REPO/skills/project-tracker/stale.txt" ]]
[[ ! -e "$REPO/skills/project-tracker/project-source/stale.txt" ]]
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

export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$TMP/sources/obsidian-learning"
export MYSKILLS_PROJECT_TRACKER_PROJECT_SOURCE="$TMP/sources/missing-project"
if (cd "$REPO" && bash scripts/import-skills.sh explain-with-diagrams project-tracker); then
  echo 'missing project source unexpectedly accepted' >&2
  exit 1
fi
[[ "$before_dest" == "$(snapshot "$REPO/skills")" ]]

printf 'import behavior is valid\n'
