#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/project-tracker-restore-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
BUNDLE="$TMP/bundle"
HOME_DIR="$TMP/home"
RESTORE_ROOT="$HOME_DIR/.local/share/project-tracker"
LOG="$TMP/installer-args.json"
mkdir -p "$BUNDLE/scripts" "$BUNDLE/references" "$BUNDLE/project-source/src/pi" \
  "$BUNDLE/project-source/web/src" "$BUNDLE/project-source/scripts" "$HOME_DIR"
cp "$ROOT/templates/project-tracker/restore-project-tracker.sh" \
  "$BUNDLE/scripts/restore-project-tracker.sh"

cat > "$BUNDLE/SKILL.md" <<'EOF'
---
name: project-tracker
description: Use when testing Project Tracker restoration.
---
# Project Tracker
EOF
printf 'reference\n' > "$BUNDLE/references/example.md"
printf 'cli source v1\n' > "$BUNDLE/project-source/src/cli.ts"
printf 'extension source\n' > "$BUNDLE/project-source/src/pi/extension.ts"
printf '<div id="root"></div>\n' > "$BUNDLE/project-source/web/index.html"
printf 'web source\n' > "$BUNDLE/project-source/web/src/main.tsx"
printf '{}\n' > "$BUNDLE/project-source/tsconfig.json"
printf 'export default {};\n' > "$BUNDLE/project-source/vite.config.ts"
printf '{}\n' > "$BUNDLE/project-source/web/tsconfig.json"
printf 'export default {};\n' > "$BUNDLE/project-source/web/vite.config.ts"
cat > "$BUNDLE/project-source/package.json" <<'EOF'
{
  "name": "project-tracker-restore-fixture",
  "version": "1.0.0",
  "scripts": {
    "build": "node -e \"const f=require('fs');f.mkdirSync('dist/pi',{recursive:true});f.writeFileSync('dist/cli.js','cli');f.writeFileSync('dist/pi/extension.js','extension')\"",
    "build:web": "node -e \"const f=require('fs');f.mkdirSync('web/dist',{recursive:true});f.writeFileSync('web/dist/index.html','built')\""
  }
}
EOF
cat > "$BUNDLE/project-source/package-lock.json" <<'EOF'
{
  "name": "project-tracker-restore-fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {"name": "project-tracker-restore-fixture", "version": "1.0.0"}
  }
}
EOF
cat > "$BUNDLE/project-source/scripts/workplane-install-choice.mjs" <<'EOF'
export const choice = "standalone";
EOF
cat > "$BUNDLE/project-source/scripts/install-skill.mjs" <<'EOF'
import "./workplane-install-choice.mjs";
import { writeFileSync } from "node:fs";
writeFileSync(process.env.RESTORE_LOG, JSON.stringify(process.argv.slice(2)));
if (process.env.RESTORE_SIGNAL === "1") {
  process.kill(process.ppid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
EOF
chmod +x "$BUNDLE/scripts/restore-project-tracker.sh"

snapshot() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do shasum "$file"; done)
}

before="$(snapshot "$BUNDLE")"
if printf 'no\n' | HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-project-tracker.sh"; then
  echo 'restoration unexpectedly proceeded without confirmation' >&2
  exit 1
fi
[[ ! -e "$RESTORE_ROOT/source" ]]

HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-project-tracker.sh" --yes
[[ "$before" == "$(snapshot "$BUNDLE")" ]] || { echo 'bundle was modified' >&2; exit 1; }
[[ -f "$RESTORE_ROOT/source/src/cli.ts" ]]
[[ -f "$RESTORE_ROOT/source/dist/cli.js" ]]
[[ -f "$RESTORE_ROOT/source/dist/pi/extension.js" ]]
[[ -f "$RESTORE_ROOT/source/web/dist/index.html" ]]
[[ -f "$RESTORE_ROOT/source/skill/project-tracker/SKILL.md" ]]
[[ -f "$RESTORE_ROOT/source/scripts/workplane-install-choice.mjs" ]]

node - "$LOG" "$RESTORE_ROOT" "$HOME_DIR" <<'EOF'
const fs = require('fs');
const [log, root, home] = process.argv.slice(2);
const args = JSON.parse(fs.readFileSync(log, 'utf8'));
const expected = [
  '--skills-dir', `${root}/installed-skills`,
  '--extensions-dir', `${home}/.pi/agent/extensions`,
  '--bin-dir', `${home}/.local/bin`,
];
if (JSON.stringify(args) !== JSON.stringify(expected)) {
  throw new Error(`unexpected installer args: ${JSON.stringify(args)}`);
}
EOF

printf 'cli source v2\n' > "$BUNDLE/project-source/src/cli.ts"
if HOME="$HOME_DIR" RESTORE_LOG="$LOG" RESTORE_SIGNAL=1 \
  bash "$BUNDLE/scripts/restore-project-tracker.sh" --yes; then
  echo 'signalled restoration unexpectedly succeeded' >&2
  exit 1
fi
[[ "$(cat "$RESTORE_ROOT/source/src/cli.ts")" == 'cli source v1' ]] || {
  echo 'signalled restoration did not restore previous source' >&2
  exit 1
}

before="$(snapshot "$BUNDLE")"
HOME="$HOME_DIR" RESTORE_LOG="$LOG" \
  bash "$BUNDLE/scripts/restore-project-tracker.sh" --yes
[[ "$(cat "$RESTORE_ROOT/source/src/cli.ts")" == 'cli source v2' ]]
[[ "$before" == "$(snapshot "$BUNDLE")" ]] || { echo 'bundle changed on repeat' >&2; exit 1; }

printf 'restoration behavior is valid\n'
