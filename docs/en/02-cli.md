# CLI Target

Registers a locally installed CLI tool (`gh`, `git`, etc.) with the clip gateway.

clip runs the command directly after ACL checks. Output is streamed in passthrough mode when connected to a TTY, and buffered when piped.

## Register

```sh
clip add <name> <command> [--allow x,y] [--deny z] [--args prepend-args]
```

```sh
# Register gh — block the delete subcommand
clip add gh gh --deny delete

# Prepend args: always insert --hostname before user args
clip add mygh gh --args "--hostname,github.example.com"
```

## Config

`~/.clip/target/cli/gh/config.yml`

```yaml
command: gh

# Arguments prepended to every invocation
args: []

# Environment variables injected at runtime
env:
  GH_TOKEN: "${GH_TOKEN}"

# Top-level ACL
allow: [pr, repo, issue]
deny: [delete]

# Tree ACL
acl:
  pr:
    allow: [list, view, create, checkout]
    deny: [close, merge, delete]
  repo:
    deny: [delete, rename]
```

## Running

```sh
# Passthrough mode (TTY) — output streams directly from gh
clip gh pr list
clip gh repo view ori-kim/cli-proxy

# Buffered mode (pipe / --pipe) — output is captured and returned
clip gh pr list --pipe
clip gh pr list | jq '.[0].number'

# JSON output — wraps stdout in a JSON envelope
clip gh pr list --json
```

## ACL

Set ACL rules with `--allow` / `--deny` flags at registration, or edit `config.yml` directly.

```sh
# Allow only pr, repo, and issue at the top level
clip add gh gh --allow pr,repo,issue

# Block only delete at the top level
clip add gh gh --deny delete
```

Tree rules in `config.yml` give per-subcommand control:

```yaml
# Allow gh pr list/view/create/checkout, block everything else under pr
# Block gh repo delete
acl:
  pr:
    allow: [list, view, create, checkout]
  repo:
    deny: [delete]
```

ACL violations are rejected before the command runs:

```sh
clip gh repo delete my-repo
# clip: denied: "delete" is not allowed for target "gh"
```

## Native Bind

Run `gh` through clip without the `clip` prefix:

```sh
clip bind gh
```

This creates a shim at `~/.clip/bin/gh`. Add it to the front of PATH so clip intercepts the command:

```sh
export PATH="$HOME/.clip/bin:$PATH"

gh pr list     # actually runs: clip gh pr list
```

## Dry Run

Preview the exact command that would execute, including prepended args:

```sh
clip gh pr list --label bug --dry-run
# gh pr list --label bug

clip gh repo clone ori-kim/cli-proxy --dry-run
# gh repo clone ori-kim/cli-proxy
```

With prepended args:

```sh
# config: args: ["--hostname", "github.example.com"]
clip mygh pr list --dry-run
# gh --hostname github.example.com pr list
```
