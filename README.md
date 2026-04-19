# clip

<img src="assets/icon.png" alt="clip icon" width="120" />

[한국어](README.ko.md)

A unified CLI proxy gateway for MCP servers and CLI tools — enforce ACL rules, handle OAuth auth, and integrate with AI agents from one command.

## Table of Contents

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Extensions](#extensions)
- [Documentation](#documentation)
- [Development](#development)

## Features

- **Unified proxy** — wrap any CLI tool, MCP server, REST/GraphQL/gRPC API behind a single gateway
- **ACL enforcement** — allow or deny subcommands per target with tree-based rules
- **OAuth 2.1 PKCE** — secure token management for MCP server authentication
- **Agent integration** — install as a Claude Code skill for AI agent workflows
- **JSON/pipe output** — machine-friendly mode for scripting and agent pipelines
- **Dry run** — preview the exact curl/command that would execute, without running it

## Install

Requires [Bun](https://bun.sh) ≥ 1.0.

```sh
bun install -g github:ori-kim/cli-proxy
```

Add to PATH if needed:

```sh
export PATH="$PATH:$HOME/.bun/bin"
```

**Native bind** — route commands through clip without the `clip` prefix:

```sh
clip bind gh
export PATH="$HOME/.clip/bin:$PATH"   # add before other entries
gh pr list   # routes through clip
```

**Agents skill:**

```sh
npx skills add ori-kim/cli-proxy
```

Install via [skills.sh](https://skills.sh) — GitHub repo-based skill registry.

**Zsh completion:**

```sh
eval "$(clip completion zsh)"
```

## Quick Start

```sh
# CLI tool
clip add gh gh --deny delete
clip gh pr list

# HTTP MCP server (with OAuth)
clip add notion https://mcp.notion.com/mcp
clip login notion
clip notion search --query "..."

# OpenAPI REST
clip add petstore https://petstore3.swagger.io/api/v3/openapi.json
clip petstore getPetById --petId 1

# gRPC
clip add my-api localhost:50051 --grpc ./api.proto
clip my-api UserService.GetUser --id 123

# GraphQL
clip add gql https://api.example.com/graphql --graphql
clip gql query --query '{ users { id name } }'
```

## Commands

| Command | Description |
|---------|-------------|
| `clip add <name> <cmd>` | Register a CLI target |
| `clip add <name> <https://...mcp>` | Register HTTP MCP |
| `clip add <name> --sse <url>` | Register SSE MCP (legacy) |
| `clip add <name> --stdio <cmd> [args]` | Register STDIO MCP |
| `clip add <name> <https://.../openapi.json>` | Register OpenAPI REST |
| `clip add <name> <host:port> --grpc [proto]` | Register gRPC |
| `clip add <name> <https://.../graphql> --graphql` | Register GraphQL |
| `clip add <name> --script` | Register script target |
| `clip remove <name>` | Unregister |
| `clip list` | List all targets |
| `clip login / logout <target>` | OAuth authentication |
| `clip refresh <target>` | Re-fetch spec or schema |
| `clip <target> tools` | List available tools/operations |
| `clip <target> describe <op>` | Show method/type details |
| `clip <target> types` | List all types (gRPC/GraphQL) |
| `clip profile add/use/list/remove/unset` | Manage profiles |
| `clip <target>@<profile> <args>` | One-shot profile override |
| `clip bind / unbind <target>` | Native command shim |
| `clip binds` | List bound targets |
| `npx skills add ori-kim/cli-proxy` | Install agent skill via skills.sh |
| `clip completion zsh` | Print zsh completion |

**Global flags:** `--json`, `--pipe`, `--dry-run`, `--help`, `--version`

Flags can be placed anywhere: `clip gh pr list --json`, `clip petstore getPetById --petId 1 --dry-run`

## Extensions

Drop a `.ts` file into `~/.clip/extensions/` to add hooks or new target types:

```ts
// ~/.clip/extensions/trace.ts
export default {
  name: "my:trace",
  init(api) {
    api.registerHook("toolcall", (ctx) => {
      api.logger.info(`→ ${ctx.targetName} ${ctx.subcommand}`);
    });
  },
};
```

See [docs/en/08-extensions.md](docs/en/08-extensions.md) for the full API: hook phases, target type registration, error handlers, and examples.

## Documentation

- [Targets overview](docs/en/01-targets.md) — target types, profiles, ACL, global flags
- [CLI target](docs/en/02-cli.md) — wrap local CLI tools with ACL, bind, dry run
- [MCP target](docs/en/03-mcp.md) — HTTP, SSE, and STDIO MCP servers, OAuth
- [API target](docs/en/04-api.md) — OpenAPI-based REST, parameter mapping, auth
- [gRPC target](docs/en/05-grpc.md) — protobuf services, schema refresh, dry run
- [GraphQL target](docs/en/06-graphql.md) — introspection, queries, mutations, auth
- [Aliases & Scripts](docs/en/07-aliases.md) — shortcut macros and script bundles
- [Extensions](docs/en/08-extensions.md) — hooks, new target types, error handlers

## Development

Requires [Bun](https://bun.sh) ≥ 1.1.

```sh
bun install
bun run src/clip.ts --help
bun run build   # → dist/
bun test
```

## License

MIT
