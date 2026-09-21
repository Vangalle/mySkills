#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/workplane-restore-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
BUNDLE="$TMP/bundle"
HOME_DIR="$TMP/home"
RESTORE_ROOT="$HOME_DIR/.local/share/workplane"
LOG="$TMP/installer-args.json"
mkdir -p "$BUNDLE/scripts" "$BUNDLE/references" "$BUNDLE/project-source/src" \
  "$BUNDLE/project-source/scripts" "$HOME_DIR"
cp "$ROOT/templates/workplane/restore-workplane.sh" "$BUNDLE/scripts/restore-workplane.sh"

cat > "$BUNDLE/SKILL.md" <<'EOF'
---
name: workplane
description: Use when testing Workplane restoration.
---
# Workplane
EOF
printf 'reference\n' > "$BUNDLE/references/example.md"
for path in cli.mjs contracts.mjs build.mjs render.mjs viewer.js; do
  printf '%s fixture\n' "$path" > "$BUNDLE/project-source/src/$path"
done
cat > "$BUNDLE/project-source/package.json" <<'EOF'
{
  "name": "workplane-restore-fixture",
  "version": "1.0.0",
  "type": "module"
}
EOF
cat > "$BUNDLE/project-source/package-lock.json" <<'EOF'
{
  "name": "workplane-restore-fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {"name": "workplane-restore-fixture", "version": "1.0.0"}
  }
}
EOF
cat > "$BUNDLE/project-source/scripts/install-skill.mjs" <<'EOF'
import { writeFileSync } from "node:fs";
writeFileSync(process.env.RESTORE_LOG, JSON.stringify(process.argv.slice(2)));
EOF
chmod +x "$BUNDLE/scripts/restore-workplane.sh"

snapshot() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do shasum "$file"; done)
}

before="$(snapshot "$BUNDLE")"
if printf 'no\n' | HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-workplane.sh"; then
  echo 'restoration unexpectedly proceeded without confirmation' >&2
  exit 1
fi
[[ ! -e "$RESTORE_ROOT/source" ]]

HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-workplane.sh" --yes
[[ "$before" == "$(snapshot "$BUNDLE")" ]] || { echo 'bundle was modified' >&2; exit 1; }
[[ -f "$RESTORE_ROOT/source/src/cli.mjs" ]]
[[ -f "$RESTORE_ROOT/source/skill/workplane/SKILL.md" ]]
[[ -d "$RESTORE_ROOT/source/node_modules" ]]
[[ ! -e "$HOME_DIR/.pi/agent/extensions/project-tracker" ]]

node - "$LOG" "$RESTORE_ROOT" "$HOME_DIR" <<'EOF'
const fs = require('fs');
const [log, root, home] = process.argv.slice(2);
const args = JSON.parse(fs.readFileSync(log, 'utf8'));
const expected = [
  '--skills-dir', `${root}/installed-skills`,
  '--bin-dir', `${home}/.local/bin`,
];
if (JSON.stringify(args) !== JSON.stringify(expected)) {
  throw new Error(`unexpected installer args: ${JSON.stringify(args)}`);
}
EOF

printf 'cli source v2\n' > "$BUNDLE/project-source/src/cli.mjs"
before="$(snapshot "$BUNDLE")"
HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-workplane.sh" --yes
[[ "$(cat "$RESTORE_ROOT/source/src/cli.mjs")" == 'cli source v2' ]]
[[ "$before" == "$(snapshot "$BUNDLE")" ]] || { echo 'bundle changed on repeat' >&2; exit 1; }

printf 'Workplane restoration behavior is valid\n'
