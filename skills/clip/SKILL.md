---
name: clip
description: CLI proxy gateway for CLI tools, MCP servers, OpenAPI REST, gRPC, and GraphQL APIs. Enforces ACL rules and handles OAuth. All external tool calls must go through clip.
---

# clip — CLI Proxy Gateway

Routes external CLI tools, MCP servers, REST/gRPC/GraphQL APIs through a single gateway with ACL enforcement and OAuth support.

## Core rule

**External tools go through `clip`.** System CLIs and dev tools run directly.

| Via `clip` | Direct |
|---|---|
| `gh`, `notion`, `linear`, `slack`, `jira`, `aws`, `gcloud`, `terraform`, gRPC servers, GraphQL APIs | `grep`, `jq`, `curl`, `bun`, `npm`, `git` |

## Usage

```sh
clip <target> <subcommand> [...args]   # run a command
clip list                               # list registered targets
clip <target> tools                     # list available tools/operations
clip <target> describe <op>            # show method or type details
clip <target> types                    # list all types (gRPC/GraphQL)
clip <target> --help                   # target help
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
clip gh issue list
clip gh pr list --json
```

**MCP** — HTTP (Streamable HTTP), SSE, or STDIO MCP server (OAuth supported)
```sh
clip notion search --query "design doc"
clip login notion    # OAuth 2.1 PKCE
```

MCP transport types:
- `http` (default) — Streamable HTTP, single endpoint
- `sse` — legacy SSE transport: `GET /sse` for stream, `POST /messages` for requests
- `stdio` — local process via stdin/stdout

**API** — OpenAPI REST target
```sh
clip petstore getPetById --petId 1
clip petstore getPetById --petId 1 --dry-run   # preview curl
```

**gRPC** — protobuf service (requires `grpcurl` in PATH)
```sh
clip my-api tools                          # list services/methods
clip my-api UserService.GetUser --id 123   # call a method
clip my-api describe UserService.GetUser   # show method signature
clip my-api types                          # list all message types
```

**GraphQL** — introspection-based GraphQL API
```sh
clip gql tools                              # list queries/mutations/subscriptions
clip gql getUser --id 123                   # run named operation
clip gql query --query '{ users { id } }'  # raw query
clip gql describe User                     # show type definition
```

**Script** — named shell scripts bundled as a target
```sh
clip my-scripts tools                      # list commands
clip my-scripts deploy production          # run a command
```

## Profiles

A target can have multiple profiles — variants that override `args`, `url`, `env`, `headers`, etc.

```sh
clip mygh@personal issue list            # one-shot override
clip profile use mygh work               # set active default
clip profile list mygh                   # inspect
```

## Aliases

Targets can define shortcut subcommands that expand into real operations:

```sh
clip notion sprint    # → clip notion search_pages --query "sprint retro"
```

## Management commands

```sh
clip add <name> <cmd>                            # register CLI target
clip add <name> <https://...mcp>                 # register HTTP MCP target
clip add <name> --sse <https://...sse>           # register SSE MCP target
clip add <name> --stdio <cmd> [args...]          # register STDIO MCP target
clip add <name> <https://.../openapi.json>       # register API target
clip add <name> <host:port> --grpc [proto]       # register gRPC target
clip add <name> <https://.../graphql> --graphql  # register GraphQL target
clip add <name> --script                         # register script target
clip remove <name>                               # unregister
clip refresh <target>                            # re-fetch spec/schema
clip login <target> / clip logout <target>       # OAuth
clip bind <target>    # native shim: "gh" routes through clip without prefix
clip binds            # list bound targets
clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]
clip profile use <target> <profile>              # set active profile
clip profile list <target>                       # list profiles
clip profile unset <target>                      # clear active
```

## ACL

Rules live in `~/.clip/target/{cli,mcp,api,grpc,graphql,script}/<name>/config.yml`. `deny` takes precedence over `allow`.

```yaml
command: gh
acl:
  delete: deny
  apply: deny
```
