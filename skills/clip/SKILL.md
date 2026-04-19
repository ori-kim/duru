---
name: clip
description: CLI proxy gateway for CLI tools, MCP servers, and OpenAPI REST APIs. Enforces ACL rules and handles OAuth. All external tool calls must go through clip.
---

# clip — CLI Proxy Gateway

Routes external CLI tools, MCP servers, and OpenAPI REST APIs through a single gateway with ACL enforcement and OAuth support.

## Core rule

**External tools go through `clip`.** System CLIs and dev tools run directly.

| Via `clip` | Direct |
|---|---|
| `gh`, `notion`, `linear`, `slack`, `jira`, `aws`, `gcloud`, `terraform` | `grep`, `jq`, `curl`, `bun`, `npm`, `git` |

## Usage

```sh
clip <target> <subcommand> [...args]   # run a command
clip list                               # list registered targets + ACL
clip <target> tools                     # list available tools/operations
clip <target> --help                    # target help
```

## Run first, explore on block

Call `clip <target> <subcommand>` directly. If you get an auth error or "target not found":
- `clip list` — see registered targets
- `clip <target> tools` — see available operations
- `clip login <target>` — re-authenticate (OAuth)

## Global flags

| Flag | Effect |
|---|---|
| `--json` | Output as JSON (unwraps MCP content, wraps CLI stdout) |
| `--pipe` | Force buffered mode (disables passthrough) |
| `--dry-run` | Print the equivalent curl/command without executing |

Flags can appear anywhere: `clip gh pr list --json`, `clip --dry-run petstore getPetById --petId 1`

## Target types

**CLI** — wraps a local command with ACL rules
```sh
clip gh get pods -n default
clip gh pr list --json
```

**MCP** — HTTP (Streamable HTTP), SSE, or STDIO MCP server (OAuth supported)
```sh
clip notion search --query "design doc"
clip login notion    # OAuth 2.1 PKCE
```

MCP transport types:
- `http` (default) — Streamable HTTP, single endpoint, response may be JSON or SSE
- `sse` — legacy SSE transport: `GET /sse` for stream, `POST /messages` for requests
- `stdio` — local process via stdin/stdout

**API** — OpenAPI REST target
```sh
clip petstore getPetById --petId 1
clip petstore getPetById --petId 1 --dry-run   # preview curl
```

## Profiles

A target can have multiple profiles — variants that override `args`, `url`, `env`, `headers`, etc. Useful when the same tool is used against multiple environments.

```sh
# One-shot override with @profile syntax
clip mygh@alpha-kr get pods -n default

# Set active default
clip profile use mygh prod-kr

# Inspect
clip profile list mygh
```

## Management commands

```sh
clip add <name> <cmd>                      # register CLI target
clip add <name> <https://...mcp>           # register HTTP MCP target
clip add <name> --sse <https://...sse>     # register SSE MCP target
clip add <name> --stdio <cmd> [args...]    # register STDIO MCP target
clip add <name> <https://.../openapi.json> # register API target
clip remove <name>                        # unregister
clip refresh <target>                     # re-fetch OpenAPI spec
clip login <target> / clip logout <target>
clip bind <target>    # native shim: "gh" routes through clip without prefix
clip binds            # list bound targets
clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]
clip profile use <target> <profile>       # set active profile
clip profile list <target>               # list profiles
clip profile unset <target>              # clear active
```

## ACL

Rules live in `~/.clip/target/{cli,mcp,api}/<name>/config.yml`. `deny` takes precedence over `allow`. Exact match or `*` wildcard (e.g. `describe-*`, `*-instances`, `get-*`).

```yaml
command: gh
acl:
  delete: deny
  apply: deny
```
