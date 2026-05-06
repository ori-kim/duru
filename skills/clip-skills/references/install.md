# Install Clip Skills To Agents

Use this reference when installing or uninstalling registered skills to agent skill directories.

## Install

```sh
clip skills install my-skill --to claude-code
clip skills install my-skill --to codex
clip skills install my-skill --to codex --mode copy
clip skills install my-skill --to codex --force
```

Supported agents:

```text
claude-code, codex, gemini, pi, cursor
```

Modes:

- `symlink` is the default. Edits to the registry skill are reflected in installed agents.
- `copy` creates a frozen snapshot.

Use `--force` only when intentionally replacing an existing path not created by clip.

## Uninstall

```sh
clip skills uninstall my-skill --from claude-code
clip skills uninstall my-skill --from codex
```

## Inspect Agent Installs

```sh
clip skills list
```

The `AGENTS` column shows where each skill is installed.
