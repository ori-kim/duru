---
name: clip-skills
description: Manage reusable prompt-template skills stored in the clip registry. Use to create, list, install to agents, import external skills, or compose skills into groups for batch activation. Route by use case and read the relevant reference for create, install, groups, or import.
---

# clip-skills

Skills are reusable prompt templates stored at `~/.clip/skills/<name>/SKILL.md`. They can be rendered with inputs and installed into agent skill directories.

## Route By Use Case

Read only the reference file needed for the request:

| User intent | Read |
|---|---|
| Create a new skill, inspect format, render inputs, show/list/remove | `references/create.md` |
| Install or uninstall a skill to an agent | `references/install.md` |
| Create, activate, deactivate, or edit skill groups | `references/groups.md` |
| Import an external skill directory into the registry | `references/import.md` |

If the request spans multiple areas, inspect with `clip skills list` first, then read the specific workflow reference.

## Core Commands

```sh
clip skills list
clip skills add <name> --description "Does something useful"
clip skills show <name>
clip skills get <name> --input key=value
clip skills install <name> --to codex
clip skills group list
```

Supported agents: `claude-code`, `codex`, `gemini`, `pi`, `cursor`.

## Directory Layout

```text
~/.clip/
  skills/
    <name>/
      SKILL.md
    groups.yml
```
