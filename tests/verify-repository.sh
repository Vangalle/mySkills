#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="$ROOT/skills"
EXPECTED=$'explain-with-diagrams\nobsidian-learning\nproject-tracker\nwriting-technical-reports'

[[ -d "$SKILLS" ]] || { echo "missing skills directory" >&2; exit 1; }
ACTUAL="$(find "$SKILLS" -mindepth 1 -maxdepth 1 -type d \
  ! -name '.myskills-import.*' -exec basename {} \; | LC_ALL=C sort)"
[[ "$ACTUAL" == "$EXPECTED" ]] || {
  printf 'unexpected skills:\n%s\n' "$ACTUAL" >&2
  exit 1
}

for skill in explain-with-diagrams project-tracker obsidian-learning writing-technical-reports; do
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
[[ -x "$SKILLS/project-tracker/scripts/restore-project-tracker.sh" ]]
[[ -f "$SKILLS/project-tracker/references/state-schema.md" ]]
PROJECT_SOURCE="$SKILLS/project-tracker/project-source"
for path in package.json package-lock.json tsconfig.json vite.config.ts \
  scripts/install-skill.mjs src/cli.ts src/pi/extension.ts \
  web/index.html web/src/main.tsx web/tsconfig.json web/vite.config.ts; do
  [[ -f "$PROJECT_SOURCE/$path" ]] || {
    echo "missing Project Tracker restoration file: $path" >&2
    exit 1
  }
done
EXPECTED_PROJECT_ROOTS=$'package-lock.json\npackage.json\nscripts\nsrc\ntsconfig.json\nvite.config.ts\nweb'
ACTUAL_PROJECT_ROOTS="$(find "$PROJECT_SOURCE" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort)"
[[ "$ACTUAL_PROJECT_ROOTS" == "$EXPECTED_PROJECT_ROOTS" ]] || {
  printf 'unexpected Project Tracker payload roots:\n%s\n' "$ACTUAL_PROJECT_ROOTS" >&2
  exit 1
}
if find "$PROJECT_SOURCE/web/src" \( -name '*.test.ts' -o -name '*.test.tsx' \) -print | grep -q .; then
  echo 'Project Tracker restoration payload contains web tests' >&2
  exit 1
fi
[[ -f "$SKILLS/obsidian-learning/scripts/obsidian_learning.py" ]]
[[ -f "$SKILLS/obsidian-learning/tests/test_obsidian_learning.py" ]]
WRITING_REPORT_FILES="$(find "$SKILLS/writing-technical-reports" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort)"
[[ "$WRITING_REPORT_FILES" == 'SKILL.md' ]] || {
  printf 'unexpected writing-technical-reports files:\n%s\n' "$WRITING_REPORT_FILES" >&2
  exit 1
}

if find "$SKILLS" \( -name '.project-tracker-source.json' -o -name '__pycache__' -o -name '*.pyc' \) -print | grep -q .; then
  echo "bundle contains machine-specific or generated files" >&2
  exit 1
fi

printf 'repository bundle is valid\n'
