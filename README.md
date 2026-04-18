# clip

CLI proxy for MCP servers and CLI tools — apply ACL rules, OAuth auth, and agent skill integration from a single gateway.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/ori-kim/cli-proxy/main/install.sh | sh
```

Installs to `~/.local/bin/clip` by default. Set `CLIP_INSTALL_DIR` to override.

**Manual download:** [Latest release](https://github.com/ori-kim/cli-proxy/releases/latest)

## Quick start

```sh
# CLI tool (gh, gh, git, gh, ...)
clip add gh gh --deny delete,apply
clip gh get pods -n default

# MCP server
clip add notion https://mcp.notion.com/mcp
clip login notion       # OAuth 인증
clip notion search --query "..."

# List targets
clip list

# Tree ACL (settings.yml 직접 편집)
# cli:
#   gh:
#     acl:
#       topic:
#         allow: [describe, list]

# Agent skill integration
clip skills add claude-code
```

Config lives at `~/.clip/settings.yml`.

## Development

```sh
bun install
bun run src/clip.ts --help   # run from source
bun run build                # compile binaries → dist/
bun test
```

Requires [Bun](https://bun.sh) ≥ 1.1.
