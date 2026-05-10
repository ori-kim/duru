# skills-flow

`skills-flow` is a clip user extension for designing agent skills as graph-shaped step flows. The MVP is a scaffold and static validation CLI, not an execution runtime.

## Install

To register this checkout as a user extension, add this entry to `CLIP_HOME/extensions/extensions.yml`.

```yaml
extensions:
  - name: skills-flow
    path: <repo>/extensions/skills-flow
    entry: src/extension.ts
    contributes:
      internalCommands: [skills-flow]
```

## Storage

Generated packages are stored separately from the legacy `clip skills` registry.

```text
$CLIP_HOME/
  skills-flow/
    my-skill/
      SKILL.md
      flow.json
      flow-ui.json  # created when nodes are moved in web
```

`flow.json` is the source of truth for step relationships. `SKILL.md` is only the bootstrap entry that tells an agent to read `flow.json`.
`flow-ui.json` is a UI-only React Flow canvas state file.

## flow-ui.json

When a node is dragged in `web`, canvas coordinates are stored by node id. Horizontal and vertical layouts can keep independent positions.

```json
{
  "schemaVersion": "1",
  "nodePositions": {
    "write-script": {
      "horizontal": { "x": 80, "y": 280 },
      "vertical": { "x": 420, "y": 120 }
    }
  }
}
```

This file does not affect `flow.json` validation. Delete `flow-ui.json` to reset the canvas layout.

## Commands

```sh
clip skills-flow create my-skill --description "My skill"
clip skills-flow create my-skill --description "My skill" --frontmatter model=gpt-5.2
clip skills-flow create my-skill --description "My skill" --frontmatter-file ./codex-skill.yml
clip skills-flow create my-skill --description "My skill" --force
clip skills-flow list [--verbose]
clip skills-flow show my-skill [--verbose]
clip skills-flow validate my-skill [--json]
clip skills-flow web [my-skill] [--port 3907]
```

Empty graphs are valid. Node and edge `type` values are free strings; stricter semantics can be added later through presets, policy, or custom validators.

`web` starts a local dashboard backed by React Flow. The UI is built with Tailwind CSS v4, Base UI primitives, and local shadcn/ui-style components. It lists every package under `$CLIP_HOME/skills-flow`, expands the selected package's nodes in the sidebar, renders the selected `flow.json` in horizontal or vertical orientation, shows validation state, loads selected node markdown from each node's `link`, and shows edge type/from/to details when an edge is selected. Dragging a node does not edit `flow.json`; it only writes canvas position state to `flow-ui.json`.
