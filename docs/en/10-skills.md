# Skills

Skills are reusable prompt templates stored under `~/.clip/skills/<name>/SKILL.md`. Each skill is a Markdown file with YAML frontmatter describing its name, description, tags, and optional input parameters.

## Quick start

```sh
clip skills add my-skill --description "Does something useful"
# → creates ~/.clip/skills/my-skill/SKILL.md
$EDITOR ~/.clip/skills/my-skill/SKILL.md

clip skills list
clip skills get my-skill --input key=value
```

## SKILL.md format

```markdown
---
name: my-skill
description: Short description shown in clip skills list
tags: [linear, github, slack]
inputs:
  ticket:
    description: Linear ticket ID
    required: true
  branch:
    description: Target branch
    default: main
---

# My Skill

For ticket {{ inputs.ticket }} on branch {{ inputs.branch }}:

1. ...
2. ...
```

### Frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Skill identifier (letters, digits, `_`, `-`) |
| `description` | string | yes | Shown in `clip skills list` |
| `tags` | string[] | no | Shown in TOOLS column; use to group by domain |
| `inputs` | object | no | Named input parameters |
| `workflow` | string | no | Reserved for future runner integration |

### Input declaration

Each key under `inputs` may have:

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable label |
| `required` | boolean | Fail if not provided |
| `default` | string | Value used when omitted |

Reference inputs in the body with `{{ inputs.key }}`.

## Commands

### Registry

| Command | Description |
|---------|-------------|
| `clip skills add <name> [--description <d>] [--tag a,b]` | Create scaffold |
| `clip skills pull <path> [<name>]` | Move external skill into registry + leave symlink at origin |
| `clip skills list [--json]` | List all skills |
| `clip skills show <name>` | Print raw SKILL.md |
| `clip skills get <name> [--input k=v ...]` | Render with inputs |
| `clip skills rm <name>` | Remove skill |

### Agent install

| Command | Description |
|---------|-------------|
| `clip skills install <name> --to <agent> [--mode symlink\|copy] [--force]` | Install to agent |
| `clip skills uninstall <name> [--from <agent>]` | Remove from agent |

### Groups

| Command | Description |
|---------|-------------|
| `clip skills group create <name> [skill ...] [--description <d>]` | Create a group |
| `clip skills group list` | List all groups |
| `clip skills group show <name>` | Show skills in group |
| `clip skills group add <name> <skill> [...]` | Add skills to group |
| `clip skills group rm <name> <skill> [...]` | Remove skills from group |
| `clip skills group delete <name>` | Delete group definition |
| `clip skills group activate <name> --to <agent> [--force]` | Symlink group skills to agent |
| `clip skills group deactivate <name> [--from <agent>]` | Remove group symlinks from agent |

## Directory layout

```
~/.clip/
  skills/
    <name>/         ← one directory per skill
      SKILL.md
    groups.yml      ← all group definitions
```

## Importing an existing skill (`pull`)

`pull` moves an external skill directory into the registry and replaces the original path with a symlink so existing references keep working:

```sh
clip skills pull ~/dotfiles/skills/my-skill
# → ~/.clip/skills/my-skill/  (actual files, moved here)
# → ~/dotfiles/skills/my-skill → ~/.clip/skills/my-skill  (symlink)
```

Pass a second argument to override the registry name:

```sh
clip skills pull ~/dotfiles/skills/my-skill renamed-skill
```

## Agent install

Install a skill into a supported agent's skills directory:

```sh
clip skills install my-skill --to claude-code
clip skills install my-skill --to codex --mode copy   # static copy
clip skills uninstall my-skill --from claude-code
```

**Supported agents:** `claude-code`, `codex`, `gemini`, `pi`, `cursor`

Default mode is `symlink` — edits to the original SKILL.md are immediately reflected in all agents. Use `--mode copy` for a frozen snapshot.

`clip skills list` shows installed agents in the AGENTS column with colored brand icons. Use `--force` to overwrite an existing path that was not installed by clip.

## Groups

Groups let you define named sets of skills and activate or deactivate them as a batch. All group definitions live in a single `~/.clip/skills/groups.yml` file that can be edited directly.

```yaml
# ~/.clip/skills/groups.yml
groups:
  work:
    description: Work-related skills
    skills:
      - linear-feature
      - slack
  personal:
    skills:
      - recap
```

```sh
# create and populate
clip skills group create work linear-feature slack --description "Work skills"
clip skills group add work notion
clip skills group rm  work slack

# deploy to an agent (symlinks each skill)
clip skills group activate work --to claude-code

# swap to another group
clip skills group deactivate work --from claude-code
clip skills group activate personal --to claude-code

# inspect
clip skills group list
clip skills group show work
```

Skills not found in the registry are skipped with a warning during `activate`.

## Rendering inputs

```sh
clip skills get my-skill --input ticket=ENG-123 --input branch=feature/x
```

Missing `required` inputs cause an error. Missing optional inputs fall back to `default`. Use `--json` to get the rendered text plus frontmatter as JSON.
