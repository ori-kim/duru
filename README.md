# clip

[한국어](README.ko.md)

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

### PATH setup

If `~/.local/bin` is not in your PATH, add this to your shell profile:

```sh
export PATH="$PATH:$HOME/.local/bin"
```

### Native bind (optional)

Bind lets you route a command through clip without the `clip` prefix:

```sh
clip bind gh   # 'gh' now routes through clip
gh pr list     # same as: clip gh pr list
```

Add `~/.clip/bin` **before** other entries so clip intercepts the command:

```sh
export PATH="$HOME/.clip/bin:$PATH"
```

## Zsh Completion

Add to `~/.zshrc`:

```sh
eval "$(clip completion zsh)"
```

Then restart your shell or run `source ~/.zshrc`.

- `clip <TAB>` — registered targets grouped by type (cli / mcp / api), with URL or command shown as description; built-in commands listed last
- `clip <target> <TAB>` — tool / operation names with descriptions (cached for 1 hour)
- `clip gh pr <TAB>` — delegates to the original command's own completion

For inline grey hints while typing, add [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) and:

```sh
ZSH_AUTOSUGGEST_STRATEGY=(history completion)
```

To force a cache refresh:

```sh
rm -f ~/.zcompcache/clip-tools-*
```

## Claude Code Integration

Install clip as a Claude Code skill to let AI agents use your registered targets:

```sh
# via skills.sh (GitHub repo, no registration required)
npx skills add https://github.com/ori-kim/cli-proxy

# or via clip itself
clip skills add claude-code
```

Once installed, Claude Code can call any clip target as a tool — ACL rules are enforced on every invocation.

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

For tree-based rules, edit `~/.clip/target/cli/gh/config.yml` directly:

```yaml
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
| `~/.clip/target/{cli,mcp,api}/<name>/config.yml` | Target config and ACL rules |
| `~/.clip/target/{mcp,api}/<name>/auth.json` | OAuth tokens |
| `~/.clip/target/api/<name>/spec.json` | Cached OpenAPI spec |
| `~/.clip/.env` | Global env vars (substituted into `config.yml`) |

## Commands

| Command | Description |
|---------|-------------|
| `clip add <name> <cmd>` | Register a CLI target |
| `clip add <name> <https://...mcp>` | Register an HTTP MCP target |
| `clip add <name> --stdio <cmd> [args]` | Register a STDIO MCP target |
| `clip add <name> <https://.../openapi.json>` | Register an OpenAPI REST target |
| `clip remove <name>` | Unregister a target |
| `clip list` | List all targets with auth status |
| `clip login <target>` | Authenticate via OAuth |
| `clip logout <target>` | Remove stored token |
| `clip refresh <target>` | Re-fetch OpenAPI spec |
| `clip <target> tools` | List available tools / operations |
| `clip bind <target>` | Create a native command shim |
| `clip unbind <target>` | Remove native command shim |
| `clip binds` | List currently bound targets |
| `clip skills add claude-code` | Install as Claude Code skill |
| `clip completion zsh` | Print zsh completion script |

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
