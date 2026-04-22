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

| Command | Description |
|---------|-------------|
| `clip skills add <name> [--description <d>] [--tag a,b]` | Create scaffold |
| `clip skills list [--json]` | List all skills |
| `clip skills show <name>` | Print raw SKILL.md |
| `clip skills get <name> [--input k=v ...]` | Render with inputs |
| `clip skills rm <name>` | Remove skill |
| `clip skills install <name> --to <agent> [--mode symlink\|copy] [--force]` | Install to agent |
| `clip skills uninstall <name> [--from <agent>]` | Remove from agent |

## Directory layout

```
~/.clip/
  skills/
    <name>/
      SKILL.md
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

## Rendering inputs

```sh
clip skills get my-skill --input ticket=ENG-123 --input branch=feature/x
```

Missing `required` inputs cause an error. Missing optional inputs fall back to `default`. Use `--json` to get the rendered text plus frontmatter as JSON.
