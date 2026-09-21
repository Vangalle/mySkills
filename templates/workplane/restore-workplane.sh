#!/usr/bin/env bash
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAYLOAD="$SKILL_ROOT/project-source"
RESTORE_ROOT="${WORKPLANE_RESTORE_ROOT:-$HOME/.local/share/workplane}"
SOURCE="$RESTORE_ROOT/source"
INSTALLED_SKILLS="$RESTORE_ROOT/installed-skills"
BIN_DIR="${WORKPLANE_BIN_DIR:-$HOME/.local/bin}"
CONFIRMED=false

if [[ "$#" -gt 1 ]]; then
  echo 'usage: restore-workplane.sh [--yes]' >&2
  exit 2
fi
if [[ "$#" -eq 1 ]]; then
  [[ "$1" == '--yes' ]] || { echo "unknown option: $1" >&2; exit 2; }
  CONFIRMED=true
fi

required=(
  package.json
  package-lock.json
  src/cli.mjs
  src/contracts.mjs
  src/build.mjs
  src/render.mjs
  src/viewer.js
  scripts/install-skill.mjs
)
for path in "${required[@]}"; do
  [[ -f "$PAYLOAD/$path" ]] || { echo "missing restoration payload: $path" >&2; exit 3; }
done

cat <<EOF
Workplane restoration will:
  copy source to: $SOURCE
  install managed skill to: $INSTALLED_SKILLS/workplane
  install CLI launcher to: $BIN_DIR/workplane
  run npm ci --omit=dev
EOF

if [[ "$CONFIRMED" != true ]]; then
  printf 'Continue? Type yes: '
  IFS= read -r answer
  [[ "$answer" == yes ]] || { echo 'Restoration cancelled.' >&2; exit 1; }
fi

mkdir -p "$RESTORE_ROOT"
STAGE="$(mktemp -d "$RESTORE_ROOT/.restore.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
STAGED_SOURCE="$STAGE/source"
mkdir -p "$STAGED_SOURCE/skill/workplane"
rsync -a "$PAYLOAD/" "$STAGED_SOURCE/"
rsync -a \
  --exclude='project-source/' \
  --exclude='.workplane-source.json' \
  --exclude='restore-workplane.sh' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  "$SKILL_ROOT/" "$STAGED_SOURCE/skill/workplane/"

(
  cd "$STAGED_SOURCE"
  npm ci --omit=dev --no-audit --no-fund
)

PREVIOUS="$STAGE/previous-source"
if [[ -e "$SOURCE" ]]; then
  mv "$SOURCE" "$PREVIOUS"
fi
if ! mv "$STAGED_SOURCE" "$SOURCE"; then
  if [[ -e "$PREVIOUS" ]]; then mv "$PREVIOUS" "$SOURCE"; fi
  exit 4
fi

if ! node "$SOURCE/scripts/install-skill.mjs" \
  --skills-dir "$INSTALLED_SKILLS" \
  --bin-dir "$BIN_DIR"; then
  rm -rf "$SOURCE"
  if [[ -e "$PREVIOUS" ]]; then mv "$PREVIOUS" "$SOURCE"; fi
  exit 5
fi

rm -rf "$PREVIOUS" "$STAGE"
trap - EXIT
printf 'Workplane restored. Start a new Pi session or run /reload.\n'
