#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ALL_SKILLS=(explain-with-diagrams project-tracker obsidian-learning writing-technical-reports)

if [[ "$#" -eq 0 ]]; then
  selected=("${ALL_SKILLS[@]}")
else
  selected=("$@")
fi

for skill in "${selected[@]}"; do
  case "$skill" in
    explain-with-diagrams|project-tracker|obsidian-learning|writing-technical-reports) ;;
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
if [[ -n "$(git diff --cached --name-only | grep -vE '^skills/(explain-with-diagrams|project-tracker|obsidian-learning|writing-technical-reports)/' || true)" ]]; then
  echo 'refusing to commit paths outside managed skill snapshots' >&2
  exit 13
fi

names=""
for skill in "${selected[@]}"; do
  if [[ -z "$names" ]]; then names="$skill"; else names="$names,$skill"; fi
done

git commit -m "chore(skills): update $names"
git push origin main
