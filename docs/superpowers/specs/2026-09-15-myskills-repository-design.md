# mySkills Repository Design

## Purpose

`Vangalle/mySkills` is the source repository for Caleb's two native Pi skills. It supports installing either skill independently, selecting skills interactively, or installing all available skills through the standard `npx skills` CLI.

The repository does not contain or modify `pi-copy-code` or any skills currently managed under `~/.agents/skills/`.

## Repository structure

```text
mySkills/
├── README.md
└── skills/
    ├── explain-with-diagrams/
    │   └── SKILL.md
    └── project-tracker/
        ├── SKILL.md
        ├── references/
        └── scripts/
```

Each complete skill directory moves from `~/.pi/agent/skills/` into `skills/` without changing its internal paths or behavior. Supporting files remain beside the corresponding `SKILL.md` so relative references continue to resolve.

## Installation interface

The README will document these standard commands:

```bash
# Inspect available skills
npx skills add Vangalle/mySkills --list

# Choose one or more interactively
npx skills add Vangalle/mySkills -g -a pi

# Install one named skill
npx skills add Vangalle/mySkills --skill project-tracker -g -a pi

# Install every skill for Pi only
npx skills add Vangalle/mySkills --skill '*' -g -a pi -y

# Install every skill for every detected agent
npx skills add Vangalle/mySkills --all -g
```

No custom installer or custom npm package will be created. Selection, installation targets, symlinking, copying, and replacement prompts remain the responsibility of the maintained `skills` CLI.

## Local source ownership

The Git checkout at `/Users/caleb/Projects/mySkills` becomes the maintained source of truth. After repository verification, the two existing directories under `~/.pi/agent/skills/` will be replaced with symlinks to their corresponding directories in the checkout.

The migration must preserve a recoverable backup until the symlinks and Pi discovery have been verified. It must not touch `~/.agents/skills/`.

## Git and publication

The two skill directories, all required supporting files, and installation documentation will be committed to `Vangalle/mySkills` and pushed to its `main` branch. The repository remains public.

No third-party local skill collections will be copied into the repository.

## Failure handling

- Stop before replacing local skill directories if either source directory is missing or incomplete.
- Exclude `project-tracker/.project-tracker-source.json`, whose absolute source and installer paths describe the current machine rather than the portable skill.
- Restore the backup if local symlink creation or Pi discovery fails.
- Do not claim GitHub publication until the pushed commit and remote file tree are verified.

## Verification

Acceptance requires fresh evidence for all of the following:

1. Both repository skill directories contain valid `SKILL.md` frontmatter and their required supporting files.
2. `npx skills add Vangalle/mySkills --list` discovers exactly the two intended skills from the published repository.
3. A temporary isolated installation can select one skill without installing the other.
4. The all-skills command installs both skills.
5. Pi's local skill paths resolve to the repository checkout after migration.
6. `Vangalle/pi-copy-code` and its local checkout remain unchanged.
