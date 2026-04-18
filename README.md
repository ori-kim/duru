# clip

A unified CLI proxy gateway for MCP servers and CLI tools — enforce ACL rules, handle OAuth auth, and integrate with AI agents from one command.

## Features

- **Unified proxy** — wrap any CLI tool or MCP server behind a single gateway
- **ACL enforcement** — allow or deny subcommands per target with tree-based rules
- **OAuth 2.1 PKCE** — secure token management for MCP server authentication
- **Agent integration** — install as a Claude Code skill for AI agent workflows
- **JSON/pipe output** — machine-friendly mode for scripting and agent pipelines

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/cli-proxy/main/install.sh | sh
```

Installs to `~/.local/bin/clip`. Set `CLIP_INSTALL_DIR` to override.

**Manual:** [Latest release](https://github.com/ori-kim/cli-proxy/releases/latest) · macOS only (darwin-arm64, darwin-x64)

## Quick Start

```sh
# Register a CLI tool
clip add gh gh --deny delete
clip gh pr list

# Register an MCP server and authenticate
clip add notion https://mcp.notion.com/mcp
clip login notion
clip notion search --query "..."

# Manage targets
clip list
clip remove notion
```

## ACL Rules

Inline flags set top-level rules:

```sh
clip add gh gh --deny delete
```

For tree-based rules, edit `~/.clip/settings.yml` directly:

```yaml
cli:
  gh:
    command: gh
    acl:
      repo:
        allow: [list, view]
      pr:
        deny: [delete]
```

`deny` takes precedence over `allow`. Rules are evaluated left-to-right on the argument tree.

## Configuration

| Path | Purpose |
|------|---------|
| `~/.clip/settings.yml` | Targets and ACL rules |
| `~/.clip/mcp/<target>/auth.json` | OAuth tokens |

## Commands

| Command | Description |
|---------|-------------|
| `clip add <name> <cmd-or-url>` | Register a target |
| `clip remove <name>` | Unregister a target |
| `clip list` | List all targets |
| `clip login <target>` | Authenticate via OAuth |
| `clip logout <target>` | Remove stored token |
| `clip <target> tools` | List MCP tools |
| `clip skills add claude-code` | Install as Claude Code skill |

**Global flags:** `--json`, `--pipe`, `--help`, `--version`

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
