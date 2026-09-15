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
