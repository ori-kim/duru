---
name: clip-skills
description: Manage reusable prompt-template skills stored in the clip registry. Use to create, list, install to agents, import external skills, or compose skills into groups for batch activation.
---

# clip-skills — Skill registry and agent install

## What skills are

Skills are named Markdown files with YAML frontmatter stored at `~/.clip/skills/<name>/SKILL.md`. They are reusable prompt templates that can be rendered with dynamic inputs and installed into AI agent skills directories (Claude Code, Codex, Gemini, Pi, Cursor).

## Core commands

```sh
# Create a new skill scaffold
clip skills add my-skill --description "Does something useful"

# Import an external skill directory (move + leave symlink at origin)
clip skills pull ~/dotfiles/skills/my-skill

# List all skills (shows which agents have each skill installed)
clip skills list

# Render a skill with inputs substituted
clip skills get my-skill --input key=value

# Print raw SKILL.md
clip skills show my-skill

# Remove from registry
clip skills rm my-skill
```

## Agent install

```sh
# Install (symlink by default)
clip skills install my-skill --to claude-code
clip skills install my-skill --to codex --mode copy   # frozen copy

# Remove
clip skills uninstall my-skill --from claude-code
```

**Agents:** `claude-code`, `codex`, `gemini`, `pi`, `cursor`

## Groups

Groups are named sets of skills that can be activated/deactivated as a batch. Stored in `~/.clip/skills/groups.yml`.

```sh
# Define a group
clip skills group create work linear-feature slack notion --description "Work skills"

# Activate: symlink all group skills to an agent
clip skills group activate work --to claude-code

# Swap to another group
clip skills group deactivate work --from claude-code
clip skills group activate personal --to claude-code

# Manage group contents
clip skills group add work jira
clip skills group rm  work slack
clip skills group list
clip skills group show work
clip skills group delete work
```

`groups.yml` can be edited directly:

```yaml
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

## pull — Import external skill

Moves an external directory into the registry and creates a reverse symlink at the original path:

```sh
clip skills pull ~/dotfiles/skills/my-skill
# real files → ~/.clip/skills/my-skill/
# symlink    → ~/dotfiles/skills/my-skill → ~/.clip/skills/my-skill
```

Optional second argument overrides the registry name.

## SKILL.md format

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
