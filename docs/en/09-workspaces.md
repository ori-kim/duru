# Workspaces

Workspaces let you maintain separate sets of targets per project or environment. When a workspace is active, its targets overlay the global config — same-named targets in the workspace override their global counterparts.

## Quick start

```sh
clip workspace new work          # create
clip workspace use work          # switch
clip add notion https://mcp.notion.com/mcp   # registers into workspace
clip workspace use -             # clear (back to global)
```

## Commands

| Command | Description |
|---------|-------------|
| `clip workspace` | Show active workspace and directory |
| `clip workspace new <name>` | Create a new workspace |
| `clip workspace use <name>` | Switch to workspace |
| `clip workspace use -` | Clear active (revert to global) |
| `clip workspace list` | List all workspaces |
| `clip workspace remove <name> [--force]` | Delete workspace |

Name rules: letters, digits, `_`, `-` only; cannot start with `.`; reserved names (`target`, `bin`, `extensions`, `hooks`) are rejected.

## Directory layout

```
~/.clip/
  .workspace                   # active workspace name (empty = global)
  workspace/
    <name>/
      target/                  # workspace-specific targets
        cli/<name>/config.yml
        mcp/<name>/config.yml
        ...
      .env                     # workspace-scoped env vars
```

## Global vs workspace targets

By default, `clip add` registers into the active workspace (if any). Use `--global` to force registration into the global config regardless:

```sh
clip workspace use work
clip add gh gh               # → ~/.clip/workspace/work/target/cli/gh/
clip add gh gh --global  # → ~/.clip/target/cli/gh/
```

## clip list workspace tags

When a workspace is active, `clip list` shows a dim `[workspace-name]` or `[global]` tag next to each target so you can see where it comes from:

```
  notion  https://mcp.notion.com/mcp  [work]
  gh      gh                          [global]
```

## Isolation and override

- Workspace targets take precedence over global targets with the same name.
- Removing a workspace target restores the global one if it exists (with a warning).
- OAuth tokens, API key caches, and spec files are stored per-target-dir, so workspace and global copies of the same target name are fully independent.

## Removing a workspace

```sh
clip workspace remove myws --force
```

`--force` is required to confirm deletion of `~/.clip/workspace/myws/` (all targets, tokens, and cached specs inside are removed). You cannot remove the currently active workspace — switch away first with `clip workspace use -`.
