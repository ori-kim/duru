# Targets

Everything in clip revolves around **targets**. A target is a registered entry that wraps an external CLI tool, MCP server, or REST API behind the clip gateway.

Run any registered target with:

```sh
clip <target> <subcommand> [args...]
```

## Target Types

| Type | Description | Examples |
|------|-------------|---------|
| [CLI](./cli.md) | Wraps a local CLI command with ACL enforcement | `gh`, `gh`, `gh` |
| [MCP (HTTP)](./mcp.md) | Connects to an HTTP MCP server (Streamable HTTP) | `notion`, `linear` |
| [MCP (SSE)](./mcp.md#sse) | Connects to a legacy SSE-transport MCP server | older MCP servers |
| [MCP (STDIO)](./mcp.md#stdio) | Spawns a local process as an MCP server | `filesystem`, `sqlite` |
| [API](./api.md) | Generates CLI tools from an OpenAPI spec | GitHub REST API, Petstore |

## Register and Manage

```sh
# Register
clip add gh gh --deny delete
clip add notion https://mcp.notion.com/mcp
clip add myserver --sse https://example.com/sse
clip add github https://api.github.com --openapi-url https://raw.githubusercontent.com/.../openapi.yaml

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
```

`deny` always takes precedence over `allow`.

## Global Flags

These flags can be placed anywhere in a command:

```sh
clip gh pr list --json            # JSON output
clip notion search_pages --dry-run  # Preview request without executing
clip gh pr list --pipe            # Force buffered mode even in a TTY
```

| Flag | Description |
|------|-------------|
| `--json` | Format output as JSON |
| `--pipe` | Force buffered mode, disabling TTY passthrough |
| `--dry-run` | Print the equivalent curl/command without executing |
