# Manage And Debug Clip Extensions

Use this reference when listing, enabling, disabling, reloading, inspecting, or debugging extension state.

## Inspect State

Start with:

```sh
clip ext list
clip ext --help
```

Inspect manifest and installed files:

```sh
cat ~/.clip/extensions/extensions.yml
find ~/.clip/extensions -maxdepth 3 -type f
```

Use repo references when working inside the clip repo:

```sh
sed -n '1,260p' docs/ko/08-extensions.md
sed -n '1,260p' apps/clip/src/commands/ext.ts
sed -n '1,260p' packages/core/src/extension.ts
find extensions -maxdepth 3 -name 'extension.ts' -type f
```

## Common Commands

```sh
clip ext list
clip ext enable <name>
clip ext disable <name>
clip ext reload <name>
clip ext info <name>
clip ext uninstall <name> --yes
clip ext types
```

Bypass user extensions while debugging:

```sh
CLIP_NO_EXTENSIONS=1 clip <target> <subcommand>
```

Built-in protocol extensions still load when `CLIP_NO_EXTENSIONS=1` is set.

## Expected List Output

`clip ext list` should show builtin and user extensions:

```text
NAME              KIND     STATUS    CONTRIBUTES
----------------  -------  --------  ------------------
protocol-cli      builtin  enabled   types=[cli]
protocol-mcp      builtin  enabled   types=[mcp]
user-sqlite       user     enabled   types=[sqlite]
my-audit          user     disabled  hooks=[target-start]
```

## Manifest Basics

User extensions live under `$CLIP_HOME/extensions`, normally `~/.clip/extensions`.

```text
~/.clip/extensions/
  extensions.yml
  myext/
    src/extension.ts
    tsconfig.json
```

Only extensions declared in `extensions.yml` are loaded. Relative `path` values resolve from `~/.clip/extensions/`.

## Two-Phase Loading

clip uses `contributes` for startup indexing and lazy loading:

```text
Phase 1: read extensions.yml and index contributes without importing code
Phase 2: import and init only matching extensions
```

Rules:

- `hooks` extensions are eager-loaded.
- `internalCommands` load when the first CLI verb matches.
- `targetTypes` load when a target of that type is used.

## Common Fixes

- If `clip <verb>` says command not found, confirm `contributes.internalCommands` contains the verb and run `clip ext reload <name>`.
- If a hook never runs, confirm `contributes.hooks` lists the phase; hook-only extensions must be eager-loaded.
- If TypeScript imports fail in the editor, run `clip ext types`; for scaffolded extensions, run `bun install` inside the extension directory.
- If an extension breaks normal work, run with `CLIP_NO_EXTENSIONS=1` and then disable it with `clip ext disable <name>`.
- If install from GitHub asks for interaction in automation, pass `--all --yes`, `--select <name> --yes`, or `--dir <path> --yes`.
