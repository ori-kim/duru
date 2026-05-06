# Create And Render Clip Skills

Use this reference when creating, listing, showing, rendering, or removing skills.

## What Skills Are

Skills are named Markdown files with YAML frontmatter stored at:

```text
~/.clip/skills/<name>/SKILL.md
```

They are reusable prompt templates that can be rendered with dynamic inputs and installed into AI agent skills directories.

## Core Commands

```sh
clip skills add my-skill --description "Does something useful"
clip skills list
clip skills show my-skill
clip skills get my-skill --input key=value
clip skills rm my-skill
```

Use `--json-output` with `list` or `get` when structured output is needed.

## SKILL.md Format

```markdown
---
name: skill-name
description: "Short description"
tags: [domain, tool]
inputs:
  param:
    description: What this input controls
    required: true
  optional_param:
    default: "fallback value"
---

Body text with {{ inputs.param }} substitution.
```

Frontmatter fields:

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | skill identifier |
| `description` | yes | trigger/display description |
| `tags` | no | domain/tool grouping |
| `inputs` | no | input parameter declaration |
| `workflow` | no | reserved for future runner integration |

Input fields:

| Field | Purpose |
|---|---|
| `description` | parameter description |
| `required` | missing input causes an error |
| `default` | fallback value |

## Render Inputs

```sh
clip skills get my-skill --input ticket=ENG-123 --input branch=feature/x
```

Missing required inputs fail. Optional inputs use their `default` values.
