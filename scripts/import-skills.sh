#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_ROOT="$ROOT/skills"
ALL_SKILLS=(explain-with-diagrams project-tracker obsidian-learning writing-technical-reports)

is_managed() {
  case "$1" in
    explain-with-diagrams|project-tracker|obsidian-learning|writing-technical-reports) return 0 ;;
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
    writing-technical-reports)
      printf '%s\n' "${MYSKILLS_WRITING_TECHNICAL_REPORTS_SOURCE:-$HOME/Projects/skill-write-technical-report}"
      ;;
  esac
}

project_tracker_project_source() {
  printf '%s\n' "${MYSKILLS_PROJECT_TRACKER_PROJECT_SOURCE:-$HOME/Projects/project-tracker/project-tracker}"
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
  if [[ "$skill" == project-tracker ]]; then
    project_source="$(project_tracker_project_source)"
    required_project_files=(
      package.json
      package-lock.json
      tsconfig.json
      vite.config.ts
      src/cli.ts
      src/pi/extension.ts
      web/index.html
      web/tsconfig.json
      web/vite.config.ts
      scripts/install-skill.mjs
    )
    for path in "${required_project_files[@]}"; do
      [[ -r "$project_source/$path" ]] || {
        echo "invalid Project Tracker project source: missing $project_source/$path" >&2
        exit 3
      }
    done
    [[ -r "$ROOT/templates/project-tracker/restore-project-tracker.sh" ]] || {
      echo 'Project Tracker restoration template is missing' >&2
      exit 3
    }
  fi
done

mkdir -p "$SKILLS_ROOT"
STAGE="$(mktemp -d "$SKILLS_ROOT/.myskills-import.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/new" "$STAGE/backup"

for skill in "${selected[@]}"; do
  source_dir="$(source_for "$skill")"
  mkdir -p "$STAGE/new/$skill"
  if [[ "$skill" == writing-technical-reports ]]; then
    rsync -a \
      --exclude='.git' \
      --exclude='.gitignore' \
      --exclude='docs/' \
      --exclude='evaluations/' \
      --exclude='tests/' \
      --exclude='__pycache__/' \
      --exclude='*.pyc' \
      "$source_dir/" "$STAGE/new/$skill/"
  else
    rsync -a \
      --exclude='.project-tracker-source.json' \
      --exclude='project-source/' \
      --exclude='restore-project-tracker.sh' \
      --exclude='__pycache__/' \
      --exclude='*.pyc' \
      "$source_dir/" "$STAGE/new/$skill/"
  fi
  [[ -r "$STAGE/new/$skill/SKILL.md" ]] || {
    echo "staged snapshot missing SKILL.md: $skill" >&2
    exit 4
  }

  if [[ "$skill" == project-tracker ]]; then
    project_source="$(project_tracker_project_source)"
    payload="$STAGE/new/$skill/project-source"
    mkdir -p "$payload/src" "$payload/web/src" "$payload/scripts"
    rsync -a "$project_source/src/" "$payload/src/"
    rsync -a --exclude='*.test.ts' --exclude='*.test.tsx' \
      "$project_source/web/src/" "$payload/web/src/"
    for path in package.json package-lock.json tsconfig.json vite.config.ts; do
      cp -p "$project_source/$path" "$payload/$path"
    done
    for path in index.html tsconfig.json vite.config.ts; do
      cp -p "$project_source/web/$path" "$payload/web/$path"
    done
    cp -p "$project_source/scripts/install-skill.mjs" "$payload/scripts/install-skill.mjs"
    mkdir -p "$STAGE/new/$skill/scripts"
    cp -p "$ROOT/templates/project-tracker/restore-project-tracker.sh" \
      "$STAGE/new/$skill/scripts/restore-project-tracker.sh"
  fi
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
