#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="$ROOT/skills"
EXPECTED=$'explain-with-diagrams\nobsidian-learning\nproject-tracker'

[[ -d "$SKILLS" ]] || { echo "missing skills directory" >&2; exit 1; }
ACTUAL="$(find "$SKILLS" -mindepth 1 -maxdepth 1 -type d \
  ! -name '.myskills-import.*' -exec basename {} \; | LC_ALL=C sort)"
[[ "$ACTUAL" == "$EXPECTED" ]] || {
  printf 'unexpected skills:\n%s\n' "$ACTUAL" >&2
  exit 1
}

for skill in explain-with-diagrams project-tracker obsidian-learning; do
  file="$SKILLS/$skill/SKILL.md"
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
  grep -q "^name: $skill$" "$file" || {
    echo "invalid name frontmatter in $file" >&2
    exit 1
  }
  grep -q '^description:' "$file" || {
    echo "missing description frontmatter in $file" >&2
    exit 1
  }
done

[[ -f "$SKILLS/explain-with-diagrams/agents/openai.yaml" ]]
[[ -f "$SKILLS/project-tracker/scripts/reporting-policy.mjs" ]]
[[ -f "$SKILLS/project-tracker/references/state-schema.md" ]]
[[ -f "$SKILLS/obsidian-learning/scripts/obsidian_learning.py" ]]
[[ -f "$SKILLS/obsidian-learning/tests/test_obsidian_learning.py" ]]

if find "$SKILLS" \( -name '.project-tracker-source.json' -o -name '__pycache__' -o -name '*.pyc' \) -print | grep -q .; then
  echo "bundle contains machine-specific or generated files" >&2
  exit 1
fi

printf 'repository bundle is valid\n'
