#!/usr/bin/env bash
set -euo pipefail

# usage: update-skills.sh [--bump patch|minor|major] [--tag vX.Y.Z] [--no-tag] [skill...]
#
# Imports the selected skill snapshots from their local source projects, runs the
# repository test suite, commits the changed snapshots, and publishes the commit
# together with a new annotated version tag. The tag defaults to a patch bump of
# the highest existing vX.Y.Z tag (or of package.json when no tag exists yet).
# --bump selects minor/major instead, --tag pins an exact version, and --no-tag
# pushes the commit without a version tag.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ALL_SKILLS=(explain-with-diagrams project-tracker workplane obsidian-learning writing-technical-reports)

usage() {
  echo 'usage: update-skills.sh [--bump patch|minor|major] [--tag vX.Y.Z] [--no-tag] [skill...]' >&2
}

bump=patch
requested_tag=''
create_tag=true
selected=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --bump)
      [[ "$#" -ge 2 ]] || { echo 'missing value for --bump' >&2; usage; exit 2; }
      bump="$2"
      shift 2
      ;;
    --tag)
      [[ "$#" -ge 2 ]] || { echo 'missing value for --tag' >&2; usage; exit 2; }
      requested_tag="$2"
      shift 2
      ;;
    --no-tag)
      create_tag=false
      shift
      ;;
    --)
      shift
      selected+=("$@")
      break
      ;;
    -*)
      echo "unknown option: $1" >&2
      usage
      exit 2
      ;;
    *)
      selected+=("$1")
      shift
      ;;
  esac
done

case "$bump" in
  patch|minor|major) ;;
  *) echo "unknown bump level: $bump (expected patch, minor or major)" >&2; exit 2 ;;
esac
if [[ -n "$requested_tag" && ! "$requested_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "invalid --tag value: $requested_tag (expected vX.Y.Z)" >&2
  exit 2
fi
if [[ "$create_tag" != true && -n "$requested_tag" ]]; then
  echo '--no-tag conflicts with --tag' >&2
  exit 2
fi

if [[ "${#selected[@]}" -eq 0 ]]; then
  selected=("${ALL_SKILLS[@]}")
fi

for skill in "${selected[@]}"; do
  case "$skill" in
    explain-with-diagrams|project-tracker|workplane|obsidian-learning|writing-technical-reports) ;;
    *) echo "unknown skill: $skill" >&2; exit 2 ;;
  esac
done

latest_released_version() {
  local latest
  latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sed 's/^v//' \
    | sort -V \
    | tail -n 1 || true)"
  if [[ -n "$latest" ]]; then
    printf '%s\n' "$latest"
    return
  fi
  node -p "require('$ROOT/package.json').version" 2>/dev/null \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || printf '0.0.0\n'
}

bump_version() {
  local version="$1" level="$2" major minor patch
  IFS='.' read -r major minor patch <<< "$version"
  case "$level" in
    major) printf '%s.0.0\n' "$((major + 1))" ;;
    minor) printf '%s.%s.0\n' "$major" "$((minor + 1))" ;;
    patch) printf '%s.%s.%s\n' "$major" "$minor" "$((patch + 1))" ;;
  esac
}

branch="$(git symbolic-ref --quiet --short HEAD || true)"
[[ "$branch" == main ]] || { echo 'update-skills requires branch main' >&2; exit 10; }
[[ -z "$(git status --porcelain)" ]] || { echo 'update-skills requires a clean working tree' >&2; exit 11; }

git fetch --tags origin main
remote_head="$(git rev-parse refs/remotes/origin/main)"
local_head="$(git rev-parse HEAD)"
[[ "$local_head" == "$remote_head" ]] || {
  echo 'local HEAD does not match origin/main' >&2
  exit 12
}

tag=''
if [[ "$create_tag" == true ]]; then
  if [[ -n "$requested_tag" ]]; then
    tag="$requested_tag"
  else
    tag="v$(bump_version "$(latest_released_version)" "$bump")"
  fi
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "tag already exists locally: $tag" >&2
    exit 16
  fi
  if [[ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]]; then
    echo "tag already exists on origin: $tag" >&2
    exit 16
  fi
fi

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
if [[ -n "$(git diff --cached --name-only | grep -vE '^skills/(explain-with-diagrams|project-tracker|workplane|obsidian-learning|writing-technical-reports)/' || true)" ]]; then
  echo 'refusing to commit paths outside managed skill snapshots' >&2
  exit 13
fi

names=""
for skill in "${selected[@]}"; do
  if [[ -z "$names" ]]; then names="$skill"; else names="$names,$skill"; fi
done

git commit -m "chore(skills): update $names"

if [[ "$create_tag" != true ]]; then
  git push origin main
  printf 'Published commit without a tag (%s).\n' "$names"
  exit 0
fi

git tag -a "$tag" -m "mySkills $tag"
if ! git push --atomic origin main "refs/tags/$tag"; then
  git tag -d "$tag" >/dev/null
  echo "push failed; removed local tag $tag (the new commit is still local)" >&2
  exit 17
fi

printf 'Published %s (commit: %s).\n' "$tag" "$names"
