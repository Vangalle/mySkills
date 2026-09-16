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

for name in explain-with-diagrams project-tracker obsidian-learning writing-technical-reports; do
  make_skill "$name"
done
PROJECT_SOURCE="$SOURCES/project-tracker-project"
mkdir -p "$PROJECT_SOURCE/src/pi" "$PROJECT_SOURCE/web/src" "$PROJECT_SOURCE/scripts"
printf 'cli\n' > "$PROJECT_SOURCE/src/cli.ts"
printf 'extension\n' > "$PROJECT_SOURCE/src/pi/extension.ts"
printf 'web\n' > "$PROJECT_SOURCE/web/index.html"
printf 'main\n' > "$PROJECT_SOURCE/web/src/main.tsx"
printf '{}\n' > "$PROJECT_SOURCE/package.json"
printf '{}\n' > "$PROJECT_SOURCE/package-lock.json"
printf '{}\n' > "$PROJECT_SOURCE/tsconfig.json"
printf 'config\n' > "$PROJECT_SOURCE/vite.config.ts"
printf '{}\n' > "$PROJECT_SOURCE/web/tsconfig.json"
printf 'config\n' > "$PROJECT_SOURCE/web/vite.config.ts"
printf 'installer\n' > "$PROJECT_SOURCE/scripts/install-skill.mjs"

export MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE="$SOURCES/explain-with-diagrams"
export MYSKILLS_PROJECT_TRACKER_SOURCE="$SOURCES/project-tracker"
export MYSKILLS_PROJECT_TRACKER_PROJECT_SOURCE="$PROJECT_SOURCE"
export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$SOURCES/obsidian-learning"
export MYSKILLS_WRITING_TECHNICAL_REPORTS_SOURCE="$SOURCES/writing-technical-reports"

mkdir -p "$WORK/scripts" "$WORK/tests" "$WORK/templates/project-tracker"
cp "$ROOT/scripts/import-skills.sh" "$WORK/scripts/import-skills.sh"
cp "$ROOT/scripts/update-skills.sh" "$WORK/scripts/update-skills.sh"
cp "$ROOT/templates/project-tracker/restore-project-tracker.sh" \
  "$WORK/templates/project-tracker/restore-project-tracker.sh"
cat > "$WORK/tests/fixture-validate.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${FAIL_VALIDATION:-0}" != 1 ]] || exit 1
for skill in explain-with-diagrams project-tracker obsidian-learning writing-technical-reports; do
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

# A runtime-only skill update commits and pushes only its SKILL.md.
cat > "$SOURCES/writing-technical-reports/SKILL.md" <<'EOF'
---
name: writing-technical-reports
description: Use when testing updated technical report imports.
---
# Updated writing technical reports
EOF
before="$(git -C "$WORK" rev-parse HEAD)"
(cd "$WORK" && bash scripts/update-skills.sh writing-technical-reports)
after="$(git -C "$WORK" rev-parse HEAD)"
[[ "$before" != "$after" ]]
[[ "$after" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$(git -C "$WORK" log -1 --format=%s)" == 'chore(skills): update writing-technical-reports' ]]
[[ "$(git -C "$WORK" diff-tree --no-commit-id --name-only -r HEAD)" == 'skills/writing-technical-reports/SKILL.md' ]]

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
