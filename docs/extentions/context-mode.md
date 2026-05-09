# clip-context-mode Extension

`clip-context-mode` lets a clip target route large command results through the upstream `context-mode` MCP server before returning them to the caller. The raw result is indexed into context-mode storage, while clip returns a compact indexed preview and search commands.

## Source And User Install

Keep the repo source and the user-installed extension separate, the same way `recap` is managed:

- Source of truth: `extensions/context-mode/`
- User install: `~/.clip/extensions/context-mode/`
- User manifest: points to `path: context-mode`, not the repo source path.

The source package is for development, review, and distribution. The user install is the runtime copy that `clip` loads from `~/.clip`.

Do not point the user manifest directly at the repo source path. That couples day-to-day clip execution to a working tree checkout and differs from the existing `recap` extension layout.

## User Manifest

Register the runtime copy in the user manifest:

```yaml
# ~/.clip/extensions/extensions.yml
extensions:
  - name: clip-context-mode
    path: context-mode
    entry: src/extension.ts
    enabled: true
    contributes:
      internalCommands: [context, ctx]
      hooks: [target-start, target-end]
```

With the extension installer, the runtime copy can be created from this repo source:

```sh
clip ext install github:<owner>/<repo> --select clip-context-mode --yes
```

This repository exposes `.clip/extension-index.yaml`, and this extension folder exposes `clip/extension.yaml`.

Install runtime dependencies in the user copy:

```sh
cd ~/.clip/extensions/context-mode
npm install
```

The runtime copy can keep a minimal `package.json` with only `context-mode` as a dependency. Do not copy the source package's `package.json` into `~/.clip/extensions/context-mode`, because the source package uses workspace dependencies such as `@clip/core`.

For source development, install workspace dependencies once from the clip repo:

```sh
bun install
```

The extension resolves the MCP command in this order:

1. `CLIP_CONTEXT_MODE_COMMAND`
2. `~/.clip/context-mode/config.yml` `mcp.command`
3. `extensions/context-mode/node_modules/.bin/context-mode`
4. repo workspace `node_modules/.bin/context-mode`
5. `~/.clip/extensions/context-mode/node_modules/.bin/context-mode`
6. `context-mode` from `PATH`

## Commands

```sh
clip context enable <target> [--mode auto|always] [--threshold bytes] [--preview bytes] [--json-chunk-mode object|batch]
clip context disable <target>
clip context status [target]
clip context doctor

clip <target> <command> ... --context-mode
clip <target> <command> ... --context off|auto|always
clip <target> <command> ... --json-chunk-mode object|batch

clip ctx search "query" [--target target] [--limit n] [--all]
clip ctx sources [--target target]
clip ctx purge [--target target] --yes
clip ctx stats
clip ctx doctor
```

## Behavior

When enabled for a target, large stdout/stderr output is buffered, indexed with upstream MCP `ctx_index`, and replaced with a compact context-mode response. Use `--context off` to bypass indexing and return the raw target output.

JSON output is adapted to markdown before calling `ctx_index`, because upstream `ctx_index` indexes markdown content. The extension supports two JSON chunk modes:

- `batch`: closest to context-mode `indexJSON()` behavior. Arrays are grouped into byte-limited batches.
- `object`: clip API-list optimized mode. Each object in a JSON array gets its own searchable section with identity fields such as `code`, `id`, `name`, and `full_name`.

`clip ctx search` uses upstream `ctx_search` by default. `clip ctx search --all` performs a local exact/term search against context-mode SQLite chunks so target-specific JSON rows are not hidden by upstream result caps.

## Storage

Configuration and clip sidecar metadata live under `~/.clip/context-mode/`.

Storage defaults to:

```yaml
storage:
  mode: auto
```

`auto` uses the active harness store when clip is running inside Claude Code, Codex, Pi, Gemini, Cursor, and similar environments. Manual shell use falls back to an isolated clip-owned home under `~/.clip/context-mode/home`, so manual runs do not accidentally mix with a harness session.

Target-scoped `sources` and `purge` inspect the local context-mode SQLite DB directly because upstream context-mode MCP does not currently expose source listing or target-scoped purge tools. Full purge delegates to upstream MCP `ctx_purge`.
