---
name: obsidian-learning
description: Use when the user explicitly wants to learn or study using Obsidian, or asks to read, create, or extend learning notes in an Obsidian vault.
---

# Learning With Obsidian

## Overview

Use deterministic code to resolve Obsidian filesystem state; use language judgment for style, structure, and teaching. In note-editing mode, build on the note's global structure and edit only a target the user confirmed.

## Required Initialization

Run this workflow whenever the skill is activated. Resolve `<skill-dir>` from this loaded `SKILL.md`; commands do not assume the process cwd.

### 1. Resolve root, vault, and scope

First run:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" config-show
```

The config is `~/.config/obsidian-learner/config.json` and separately records `obsidianRoot` plus concrete `vaults`. The configured `obsidianRoot` is always the container boundary, never a concrete vault—even if it contains `.obsidian`. Vault candidates must be strict descendants of that root and contain their own `.obsidian` directory.

If configuration exists, rescan its root on every initialization:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" discover --search-root "<configured-root>"
```

Compare discovered vaults with configured vaults. Treat any non-empty `staleVaults` as removals even when the filtered configured list equals discovery. If there are additions or removals, show them and wait for confirmation before saving the reconciled list. If discovery reports errors, report them and do not overwrite the known configuration with a possibly partial result.

If configuration is missing or invalid, run `discover` without `--search-root`. Discovery uses filesystem search plus grep and may return a root, multiple roots, or multiple vaults. Show the results and wait for the user to confirm the root and vault list. Only then persist them:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" config-save \
  --root "<confirmed-root>" \
  --vault "<confirmed-vault-1>" \
  --vault "<confirmed-vault-2>"
```

Never persist an inferred or partial discovery result before confirmation. Then run:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" context --cwd "$PWD"
```

Interpret `context` as follows:

- `requiresSelection: false`: cwd is inside a vault; use `activeVault` immediately and use cwd as `scope`. Do not ask the user to select that vault again.
- `requiresSelection: true`: cwd is outside every vault, including when cwd equals the shared root. Show recorded concrete vaults, ask the user to choose one, then rerun `context --vault "<choice>"`. The selected vault becomes the scope.

State the resolved Obsidian root, active vault, and scope before continuing. Do not read notes until the active vault is resolved.

### 2. Load the vault writing style

Resolve the only allowed style path first:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" validate-style --vault "<active-vault>"
```

Use the returned `styleFile` path.

- If `exists` is true, read it completely.
- If false, run:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" sample --scope "<scope>" --limit 10
```

The helper returns every eligible Markdown note when there are at most 10 and selects 10 when there are more. It never expands beyond the scope to fill the quota. Read every returned note, infer the writing style yourself, and create only the validated `styleFile`. Summarize the style top-down: organization first, then headings and explanatory order, then paragraph, terminology, formula, list, link, and tag habits. Do not use fixed code rules to manufacture a style.

If no notes are returned, tell the user style cannot yet be inferred; do not invent style evidence.

### 3. Select and persist a mode

There is no default. Ask the user to choose:

1. `direct` — answer in chat;
2. `notes` — answer by modifying a note.

Use `PI_SESSION_ID`. If unavailable, generate one safe ID once and reuse it throughout this conversation. After the choice, run:

```bash
python3 "<skill-dir>/scripts/obsidian_learning.py" mode-set \
  --session-id "<session-id>" --mode "<direct-or-notes>"
```

Tell the user the selected mode and print the returned absolute `modeFile` path. A mode is not initialized merely because it was announced. When the user switches mode, update the same file and print its path again.

## Mode Contracts

### Direct mode

Answer in chat. Do not enter the candidate-selection or note-editing flow unless the user switches mode.

### Notes mode

Follow this sequence for every question.

1. **Predict candidates with code.** Run:
   ```bash
   python3 "<skill-dir>/scripts/obsidian_learning.py" search \
     --scope "<scope>" --query "<user-question>" --limit 5
   ```
2. **Ask for target confirmation.** Present likely paths, titles, and brief semantic reasons. If all returned scores are 0, label them as a bounded fallback with no lexical match and ask the user to choose or specify another in-scope note. The ranking suggests candidates; it never authorizes an edit. Remain read-only until explicit confirmation.
3. **Validate.** Run `validate-note --scope "<scope>" --note "<confirmed-note>"`. Stop if it rejects the path.
4. **Read before writing.** Read the complete target note and complete validated style file. Run `validate-note` on every directly related linked note before reading it; linked context remains inside scope.
5. **Map the global structure.** Identify the note's theme, core conclusion, causal chain, heading hierarchy, and the exact node where the question belongs. Decide whether to extend an existing section, add a subordinate section, or propose a focused secondary note. Creating or modifying any secondary note requires separate user confirmation.
6. **Edit in matching style.** Revalidate the target and style paths immediately before writing. Preserve the overview and chapter relationships. Give conclusions and conceptual relations before formulas, examples, and boundaries. Repair local ambiguity locally; do not let a detail replace or bury the main framework. Avoid unrelated rewrites.
7. **Review and report.** Reread the surrounding section and style guide. Fix repetition, hierarchy damage, or style drift. Report the modified path, insertion location, and concise change summary.

## Safe Command Arguments

Code blocks show argument shapes, not permission to interpolate raw user text. Shell-quote every dynamic path, session ID, and query as one argument; never concatenate untrusted text into shell syntax. Prefer structured tool arguments where available.

## Quick Reference

| State | Required action |
|---|---|
| Config missing/stale | Discover → show → user confirms → save |
| Cwd inside a vault | Select it directly; scope is cwd |
| Cwd outside vaults | User selects a concrete vault; scope is that vault |
| Style missing | Code samples ≤10 notes; agent infers and writes style |
| Mode selected/switched | Write state and show absolute `modeFile` |
| Notes-mode question | Search → explain candidates → confirm → validate → map → edit |

## Common Mistakes

- Treating the shared Obsidian root as a vault because it contains `.obsidian`; the root remains the container boundary.
- Searching another directory to reach 10 style samples.
- Asking for a vault even though `context` resolved cwd inside one.
- Announcing a mode without calling `mode-set` and showing `modeFile`.
- Editing the top-ranked candidate without explicit confirmation.
- Inserting locally relevant detail where it damages the note's overview or causal chain.

## Red Flag

If you are about to say “mode selected” without a helper-returned `modeFile`, stop: persist the mode first, then include that absolute path in the response.
