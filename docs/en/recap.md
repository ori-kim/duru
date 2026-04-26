# recap — Personalized Tacit Knowledge Store

## Why It Exists

`clip list` shows which external tools are registered. But real tasks often need personalized context that isn't visible from the target list — domain conventions, org structure, process templates, or details only one person knows. `recap` stores that tacit knowledge as named entries so any agent, session, or collaborator can access the same context.

## Model

- **Targets**: recap groups that map 1:1 to a registered clip target (e.g. `slack`, `notion`, `linear`). Context surfaces naturally when working with that target.
- **Bundles**: recap groups for domains not tied to a specific tool (e.g. an org bundle for people, teams, personas, processes).

## Directory Structure

```
~/.clip/recap/
  <group>/
    index.json          # entry metadata: name, description, updatedAt, file
    reference/
      <entry>.md        # entry body
```

## Usage

See `skills/recap/SKILL.md` or run `clip recap --help`.
