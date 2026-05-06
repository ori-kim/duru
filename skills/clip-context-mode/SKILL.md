---
name: clip-context-mode
description: Use clip's context-mode extension to index large clip target outputs through the upstream context-mode MCP server, then search or purge the indexed result.
---

# clip-context-mode

Use this when a clip target may return large output that should be indexed into context-mode instead of pasted raw into an agent context.

## Usage

Enable a target:

```sh
clip context enable <target>
clip context status <target>
```

One-shot mode for a single command:

```sh
clip <target> <command> ... --context-mode
clip <target> <command> ... --context off
clip <target> <command> ... --context always
```

Search indexed output:

```sh
clip ctx search "query" --target <target>
clip ctx search "query" --target <target> --all --limit 50
clip ctx sources --target <target>
clip ctx purge --target <target> --yes
clip ctx stats
```

## JSON Chunk Modes

Use `--json-chunk-mode object` for API list responses where each JSON array object should be independently searchable. Use `--json-chunk-mode batch` when you want behavior closer to upstream context-mode `indexJSON()` batching.

`clip ctx search --all` is useful after `object` indexing when exact rows are expected but upstream `ctx_search` returns only a capped subset.

## Bypass Rule

If the user asks for raw output or exact command output, pass `--context off` so clip returns the original stdout/stderr without context-mode compaction.
