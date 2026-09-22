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

for name in explain-with-diagrams project-tracker workplane obsidian-learning writing-technical-reports; do
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
printf 'choice\n' > "$PROJECT_SOURCE/scripts/workplane-install-choice.mjs"
WORKPLANE_PROJECT_SOURCE="$SOURCES/workplane-project"
mkdir -p "$WORKPLANE_PROJECT_SOURCE/src" "$WORKPLANE_PROJECT_SOURCE/scripts"
for path in cli.mjs contracts.mjs build.mjs render.mjs viewer.js; do
  printf '%s\n' "$path" > "$WORKPLANE_PROJECT_SOURCE/src/$path"
done
printf '{"name":"workplane"}\n' > "$WORKPLANE_PROJECT_SOURCE/package.json"
printf '{"lockfileVersion":3}\n' > "$WORKPLANE_PROJECT_SOURCE/package-lock.json"
printf 'installer\n' > "$WORKPLANE_PROJECT_SOURCE/scripts/install-skill.mjs"

export MYSKILLS_EXPLAIN_WITH_DIAGRAMS_SOURCE="$SOURCES/explain-with-diagrams"
export MYSKILLS_PROJECT_TRACKER_SOURCE="$SOURCES/project-tracker"
export MYSKILLS_PROJECT_TRACKER_PROJECT_SOURCE="$PROJECT_SOURCE"
export MYSKILLS_WORKPLANE_SOURCE="$SOURCES/workplane"
export MYSKILLS_WORKPLANE_PROJECT_SOURCE="$WORKPLANE_PROJECT_SOURCE"
export MYSKILLS_OBSIDIAN_LEARNING_SOURCE="$SOURCES/obsidian-learning"
export MYSKILLS_WRITING_TECHNICAL_REPORTS_SOURCE="$SOURCES/writing-technical-reports"

mkdir -p "$WORK/scripts" "$WORK/tests" "$WORK/templates/project-tracker" "$WORK/templates/workplane"
cp "$ROOT/scripts/import-skills.sh" "$WORK/scripts/import-skills.sh"
cp "$ROOT/scripts/update-skills.sh" "$WORK/scripts/update-skills.sh"
cp "$ROOT/templates/project-tracker/restore-project-tracker.sh" \
  "$WORK/templates/project-tracker/restore-project-tracker.sh"
cp "$ROOT/templates/workplane/restore-workplane.sh" \
  "$WORK/templates/workplane/restore-workplane.sh"
cat > "$WORK/tests/fixture-validate.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${FAIL_VALIDATION:-0}" != 1 ]] || exit 1
for skill in explain-with-diagrams project-tracker workplane obsidian-learning writing-technical-reports; do
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

# A selected update creates one scoped commit, pushes it, and tags it as v0.0.1
# (patch bump of the fixture's package.json version 0.0.0).
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
[[ "$(git -C "$WORK" cat-file -t v0.0.1)" == 'tag' ]]
[[ "$(git -C "$WORK" rev-parse 'v0.0.1^{commit}')" == "$after" ]]
[[ "$(git --git-dir="$REMOTE" rev-parse 'refs/tags/v0.0.1^{commit}')" == "$after" ]]

# No changes means no commit, no remote ref movement, and no new tag.
before="$after"
output="$(cd "$WORK" && bash scripts/update-skills.sh project-tracker)"
[[ "$output" == *'No skill changes to publish.'* ]]
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$before" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$(git --git-dir="$REMOTE" tag --list | wc -l | tr -d ' ')" == '1' ]]

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
[[ "$(git -C "$WORK" rev-parse 'v0.0.2^{commit}')" == "$after" ]]
[[ "$(git --git-dir="$REMOTE" rev-parse 'refs/tags/v0.0.2^{commit}')" == "$after" ]]

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
tags_before="$(git --git-dir="$REMOTE" tag --list)"
if (cd "$WORK" && FAIL_VALIDATION=1 bash scripts/update-skills.sh project-tracker); then
  echo 'validation failure unexpectedly published' >&2
  exit 1
fi
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$remote_before" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$tags_before" == "$(git --git-dir="$REMOTE" tag --list)" ]]
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

# A minor bump publishes the next minor version tag.
printf 'minor-bump\n' > "$SOURCES/obsidian-learning/value.txt"
(cd "$WORK" && bash scripts/update-skills.sh --bump minor obsidian-learning)
after="$(git -C "$WORK" rev-parse HEAD)"
[[ "$after" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$(git -C "$WORK" rev-parse 'v0.1.0^{commit}')" == "$after" ]]
[[ "$(git --git-dir="$REMOTE" rev-parse 'refs/tags/v0.1.0^{commit}')" == "$after" ]]

# An explicit --tag pins the released version, and later default bumps continue from it.
printf 'pinned-tag\n' > "$SOURCES/writing-technical-reports/value.txt"
(cd "$WORK" && bash scripts/update-skills.sh --tag v5.0.0 writing-technical-reports)
after="$(git -C "$WORK" rev-parse HEAD)"
[[ "$(git -C "$WORK" rev-parse 'v5.0.0^{commit}')" == "$after" ]]
[[ "$(git --git-dir="$REMOTE" rev-parse 'refs/tags/v5.0.0^{commit}')" == "$after" ]]
printf 'after-pin-bump\n' > "$SOURCES/workplane/value.txt"
(cd "$WORK" && bash scripts/update-skills.sh workplane)
after="$(git -C "$WORK" rev-parse HEAD)"
[[ "$(git -C "$WORK" rev-parse 'v5.0.1^{commit}')" == "$after" ]]

# --no-tag publishes the commit without creating a tag.
printf 'no-tag\n' > "$SOURCES/explain-with-diagrams/value.txt"
tags_before="$(git --git-dir="$REMOTE" tag --list | LC_ALL=C sort)"
(cd "$WORK" && bash scripts/update-skills.sh --no-tag explain-with-diagrams)
after="$(git -C "$WORK" rev-parse HEAD)"
[[ "$after" == "$(git --git-dir="$REMOTE" rev-parse refs/heads/main)" ]]
[[ "$tags_before" == "$(git --git-dir="$REMOTE" tag --list | LC_ALL=C sort)" ]]

# Reusing an existing tag is rejected before any source is imported.
printf 'collision-candidate\n' > "$SOURCES/project-tracker/value.txt"
bundled_before="$(cat "$WORK/skills/project-tracker/value.txt")"
before="$(git -C "$WORK" rev-parse HEAD)"
if (cd "$WORK" && bash scripts/update-skills.sh --tag v5.0.0 project-tracker); then
  echo 'existing tag unexpectedly reused' >&2
  exit 1
fi
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$bundled_before" == "$(cat "$WORK/skills/project-tracker/value.txt")" ]]

# Malformed or conflicting tag requests never import or commit.
for bad_tag in v1.2 1.2.3 vabc; do
  if (cd "$WORK" && bash scripts/update-skills.sh --tag "$bad_tag" project-tracker); then
    echo "malformed tag $bad_tag unexpectedly accepted" >&2
    exit 1
  fi
done
if (cd "$WORK" && bash scripts/update-skills.sh --no-tag --tag v9.9.9 project-tracker); then
  echo 'conflicting tag options unexpectedly accepted' >&2
  exit 1
fi
if (cd "$WORK" && bash scripts/update-skills.sh --bump sideways project-tracker); then
  echo 'invalid bump level unexpectedly accepted' >&2
  exit 1
fi
[[ "$before" == "$(git -C "$WORK" rev-parse HEAD)" ]]
[[ "$bundled_before" == "$(cat "$WORK/skills/project-tracker/value.txt")" ]]

# Every published tag points at a commit on the remote main branch.
git --git-dir="$REMOTE" fetch --quiet . main:refs/remotes/origin/main
for tag in v0.0.1 v0.0.2 v0.1.0 v5.0.0 v5.0.1; do
  git --git-dir="$REMOTE" merge-base --is-ancestor "refs/tags/$tag^{commit}" refs/heads/main
  [[ "$(git -C "$WORK" cat-file -t "$tag")" == 'tag' ]]
done

printf 'update behavior is valid\n'
