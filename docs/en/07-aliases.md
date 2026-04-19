# Aliases & Scripts

## Aliases

Any target type supports **aliases** — custom subcommand shortcuts that expand into real subcommands with argument placeholders.

### Config

Add an `aliases` block to any target's `config.yml`:

```yaml
# ~/.clip/target/mcp/notion/config.yml
aliases:
  sprint:
    subcommand: search_pages
    args: ["--query", "sprint retro"]
    description: "Search sprint retro pages"

  page:
    subcommand: get_page
    input:
      page_id: "$1"
    description: "Get a page by ID"
```

### Placeholders

| Placeholder | Meaning |
|-------------|---------|
| `$@` | All user args as separate tokens |
| `$*` | All user args as one space-joined string |
| `$1`, `$2`, … | Positional arg at index |
| `${VAR}` | Env var from target env or process env |
| `$$` | Literal `$` |

If no placeholder is present, user args are **appended** after the template.

### Usage

```sh
clip notion sprint              # → clip notion search_pages --query "sprint retro"
clip notion sprint q2-review    # → clip notion search_pages --query "sprint retro" q2-review
clip notion page abc123         # → clip notion get_page (with page_id: "abc123")
```

Aliases work with all target types — MCP, CLI, API, gRPC, GraphQL, Script.

---

## Script Target

Bundles named shell commands (inline scripts or external files) under a single clip target.

### Register

```sh
clip add my-scripts --script
```

Then edit `~/.clip/target/script/my-scripts/config.yml`.

### Config

```yaml
description: "My dev scripts"

commands:
  deploy:
    script: |
      echo "Deploying to $1..."
      ./deploy.sh "$1"
    args: [env]
    description: "Deploy to an environment"

  greet:
    file: ./scripts/greet.sh    # external executable
    args: [name]
    description: "Say hello"
    env:
      GREETING: "Hello"
```

`script` and `file` are mutually exclusive — use exactly one per command. External files must be executable (`chmod +x`).

### Running

```sh
# List commands
clip my-scripts tools

# Run a command
clip my-scripts deploy production
clip my-scripts greet Alice

# Show command help
clip my-scripts deploy --help
```

### Dry Run

```sh
clip my-scripts deploy production --dry-run
# script:
# echo "Deploying to $1..."
# ./deploy.sh "$1"
# args: ["production"]
```

### Aliases in Script Targets

Script targets also support aliases — shortcuts that call other commands:

```yaml
commands:
  deploy:
    script: ./deploy.sh $@
    args: [env]
aliases:
  ship:
    subcommand: deploy
    args: ["production"]
    description: "Deploy to production"
```

```sh
clip my-scripts ship    # → clip my-scripts deploy production
```
