# duru

<img src="assets/icon.png" alt="duru icon" width="120" />

[한국어](README.ko.md)

> **Pre-release:** duru is not yet production-ready. APIs and configuration formats may change without notice between versions.

A framework service for wiring CLI tools, MCP servers, APIs, skills, and agent workflows behind one command surface.

## Table of Contents

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Extensions](#extensions)
- [Documentation](#documentation)
- [Development](#development)

## Features

- **Unified framework surface** — wrap CLI tools, MCP servers, REST/GraphQL/gRPC APIs, and workflow helpers behind one runtime
- **ACL enforcement** — allow or deny subcommands per target with tree-based rules
- **OAuth 2.1 PKCE** — secure token management for MCP server authentication
- **Agent integration** — install as a Claude Code skill for AI agent workflows
- **JSON/pipe output** — machine-friendly mode for scripting and agent pipelines
- **Dry run** — preview the exact curl/command that would execute, without running it

## Install

**Pre-built binary** (Apple Silicon only, no dependencies):

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/duru/main/install.sh | sh
```

Default install path: `~/.local/bin/duru`. Override with `DURU_INSTALL_DIR`.

**Via Bun** (requires [Bun](https://bun.sh) ≥ 1.0):

```sh
bun install -g github:ori-kim/duru
```

Add to PATH if needed:

```sh
export PATH="$PATH:$HOME/.bun/bin"
```

**Native bind** — route commands through duru without the `duru` prefix:

```sh
duru gateway add gh gh
duru gateway bind gh gh
export PATH="$HOME/.duru/bin:$PATH"   # add before other entries
gh pr list   # routes through duru
```

**Agents skill:**

```sh
npx skills add ori-kim/duru
```

Install via [skills.sh](https://skills.sh) — GitHub repo-based skill registry.

**Zsh completion:**

```sh
eval "$(duru completion zsh)"
```

**Update:**

```sh
duru update --check
duru update --yes
```

## Quick Start

```sh
# CLI tool
duru gateway add gh gh --deny delete
duru gh pr list

# HTTP MCP server (with OAuth)
duru gateway add notion https://mcp.notion.com/mcp
duru gateway login notion
duru notion search --query "..."

# OpenAPI REST
duru gateway add petstore https://petstore3.swagger.io/api/v3/openapi.json
duru petstore getPetById --petId 1

# gRPC
duru gateway add my-api localhost:50051 --grpc ./api.proto
duru my-api UserService.GetUser --id 123

# GraphQL
duru gateway add gql https://api.example.com/graphql --graphql
duru gql query --query '{ users { id name } }'
```

## Commands

| Command | Description |
|---------|-------------|
| `duru gateway add <name> <cmd>` | Register a CLI target |
| `duru gateway add <name> <https://...mcp>` | Register HTTP MCP |
| `duru gateway add <name> --sse <url>` | Register SSE MCP (legacy) |
| `duru gateway add <name> --stdio <cmd> [args]` | Register STDIO MCP |
| `duru gateway add <name> <https://.../openapi.json>` | Register OpenAPI REST |
| `duru gateway add <name> <host:port> --grpc [proto]` | Register gRPC |
| `duru gateway add <name> <https://.../graphql> --graphql` | Register GraphQL |
| `duru gateway add <name> --script` | Register script target |
| `duru gateway remove <name>` | Unregister |
| `duru gateway list` | List all targets |
| `duru gateway login / logout <target>` | OAuth authentication |
| `duru gateway refresh <target>` | Re-fetch spec or schema |
| `duru update [--check]` | Update the local duru binary from the latest release |
| `duru <target> tools` | List available tools/operations |
| `duru <target> describe <op>` | Show method/type details |
| `duru <target> types` | List all types (gRPC/GraphQL) |
| `duru gateway profile add/use/list/remove/unset` | Manage profiles |
| `duru <target>@<profile> <args>` | One-shot profile override |
| `duru gateway bind <name> <target> [...args]` | Native command shim |
| `duru gateway unbind <name>` | Remove native command shim |
| `duru gateway binds` | List bound targets |
| `duru skills add <name>` | Create a prompt-template skill |
| `duru skills list` | List skills (shows installed agents) |
| `duru skills get <name> [--input k=v ...]` | Render skill with inputs |
| `duru skills install <name> --to <agent>` | Install skill to agent |
| `duru skills uninstall <name>` | Remove skill from agent |
| `npx skills add ori-kim/duru` | Install agent skill via skills.sh |
| `duru completion zsh` | Print zsh completion |

**Global flags:** `--json`, `--json-output`, `--pipe`, `--dry-run`, `--help`, `--version`

Flags can be placed anywhere: `duru gh pr list --json`, `duru petstore getPetById --petId 1 --dry-run`

**Target timeout:** `timeoutMs` in target config wins, then `DURU_TARGET_TIMEOUT_MS`, then default `30000` ms.

## Extensions

Drop a `.ts` file into `~/.duru/extensions/` to add hooks or new target types:

```ts
// ~/.duru/extensions/trace.ts
export default {
  name: "my:trace",
  init(api) {
    api.registerHook("subcommand-start", (ctx) => {
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
- [Skills](docs/en/10-skills.md) — reusable prompt templates with inputs, agent install

## Development

Requires [Bun](https://bun.sh) ≥ 1.1.

```sh
bun install
bun run src/duru.ts --help
bun run build   # → dist/
bun test
```

## Versioning

duru uses **[HeadVer](https://techblog.lycorp.co.jp/ko/headver-new-versioning-system-for-product-teams)** — a versioning system designed for product teams by LY Corporation.

Format: `Head.YearWeek.Build`

| Field | Set by | Meaning |
|-------|--------|---------|
| `Head` | Manual | Increments with each meaningful release. `0` = pre-release. |
| `YearWeek` | Auto | ISO 8601 year + week number (e.g. `2617` = 2026 week 17) |
| `Build` | Auto | Git commit count — uniquely identifies the exact binary |

## License

MIT
