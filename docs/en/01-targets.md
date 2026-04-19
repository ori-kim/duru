# Targets

Everything in clip revolves around **targets**. A target is a registered entry that wraps an external CLI tool, MCP server, or API behind the clip gateway.

Run any registered target with:

```sh
clip <target> <subcommand> [args...]
```

## Target Types

| Type | Description | Examples |
|------|-------------|---------|
| [CLI](./02-cli.md) | Wraps a local CLI command with ACL enforcement | `gh`, `gh`, `gh` |
| [MCP (HTTP)](./03-mcp.md) | Connects to an HTTP MCP server (Streamable HTTP) | `notion`, `linear` |
| [MCP (SSE)](./03-mcp.md#sse) | Connects to a legacy SSE-transport MCP server | older MCP servers |
| [MCP (STDIO)](./03-mcp.md#stdio) | Spawns a local process as an MCP server | `filesystem`, `sqlite` |
| [API](./04-api.md) | Generates CLI tools from an OpenAPI spec | GitHub REST API, Petstore |
| [gRPC](./05-grpc.md) | Connects to a gRPC server (reflection or proto) | internal services |
| [GraphQL](./06-graphql.md) | Introspection-based GraphQL API | any GraphQL endpoint |
| [Script](./07-aliases.md#script-target) | Bundles named shell scripts as a target | dev automation |

## Register and Manage

```sh
# Register
clip add gh gh --deny delete
clip add notion https://mcp.notion.com/mcp
clip add myserver --sse https://example.com/sse
clip add github https://api.github.com --openapi-url https://raw.githubusercontent.com/.../openapi.yaml
clip add my-api localhost:50051 --grpc ./api.proto
clip add gql https://api.example.com/graphql --graphql
clip add my-scripts --script

# List all targets
clip list

# Remove
clip remove gh
```

## Config File Locations

```
~/.clip/target/
  cli/<name>/config.yml
  mcp/<name>/config.yml
  api/<name>/config.yml
        spec.json          # Cached OpenAPI spec
        auth.json          # OAuth / API key tokens
  grpc/<name>/config.yml
        schema.json        # Cached gRPC schema
  graphql/<name>/config.yml
        schema.json        # Cached GraphQL schema
  script/<name>/config.yml
```

## Common Fields

These fields are available in every target's `config.yml`.

```yaml
# Top-level ACL — allow or deny subcommands
allow: [pr, repo]
deny: [delete]

# Tree ACL — fine-grained control down the argument tree
acl:
  pr:
    allow: [list, view, create]
    deny: [close, merge]
  repo:
    deny: [delete]

# Auth method
auth: false        # None (default)
auth: oauth        # OAuth 2.1 PKCE
auth: apikey       # Pass token via headers

# Headers (for apikey auth or custom headers)
headers:
  Authorization: "Bearer ${GITHUB_TOKEN}"
  X-Custom-Header: "value"

# Aliases — custom subcommand shortcuts
aliases:
  my-alias:
    subcommand: real-subcommand
    args: ["--flag", "value"]
    description: "shortcut description"
```

`deny` always takes precedence over `allow`.

## Profiles

Register multiple variants (profiles) on a single target. Each profile overrides a subset of the target's fields — `args`, `url`, `env`, `headers`, etc.

### Setup and Usage

```sh
# Register base target
clip add mygh gh --allow "get,describe,logs,top"

# Add profiles
clip profile add mygh prod-kr --args "exec,example/prod/kr,--,gh"
clip profile add mygh alpha-kr --args "exec,example/alpha/kr,--,gh"

# Set active default
clip profile use mygh prod-kr

# Run with active profile
clip mygh get pods -n default

# One-shot override
clip mygh@alpha-kr get pods -n default

# List profiles
clip profile list mygh

# Clear active
clip profile unset mygh

# Remove a profile
clip profile remove mygh alpha-kr
```

### Profile Commands

| Command | Description |
|---------|-------------|
| `clip profile add <target> <profile> [opts]` | Create or update a profile |
| `clip profile remove <target> <profile>` | Delete a profile |
| `clip profile list <target>` | List profiles with active marker |
| `clip profile use <target> <profile>` | Set active profile |
| `clip profile unset <target>` | Clear active profile |
| `clip <target>@<profile> <args>` | One-shot profile override |

### `profile add` Flags

| Flag | Applies to | Description |
|------|-----------|-------------|
| `--args a,b,c` | CLI, STDIO MCP | Replace prepend args |
| `--command <cmd>` | CLI, STDIO MCP | Replace base command |
| `--env KEY=VAL` | CLI, STDIO MCP | Add env var (repeatable) |
| `--url <url>` | MCP HTTP/SSE | Replace endpoint URL |
| `--endpoint <url>` | GraphQL | Replace endpoint |
| `--address <host:port>` | gRPC | Replace address |
| `--base-url <url>` | API | Replace baseUrl |
| `--header KEY:VAL` | MCP/API/gRPC/GraphQL | Add header (repeatable) |
| `--metadata KEY=VAL` | gRPC | Add metadata (repeatable) |

### Merge Rules

- Scalar/array fields (`args`, `url`, `command`, `address`, …): profile value **replaces** target value
- Map fields (`env`, `headers`, `metadata`): profile entries are **merged** on top of target values (profile wins)
- ACL fields (`allow`, `deny`, `acl`): managed on the target only — profiles cannot bypass ACL

## Global Flags

These flags can be placed anywhere in a command:

```sh
clip gh pr list --json              # JSON output
clip notion search_pages --dry-run  # Preview request without executing
clip gh pr list --pipe              # Force buffered mode even in a TTY
```

| Flag | Description |
|------|-------------|
| `--json` | Format output as JSON |
| `--pipe` | Force buffered mode, disabling TTY passthrough |
| `--dry-run` | Print the equivalent curl/command without executing |
