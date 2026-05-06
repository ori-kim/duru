# Clip Aliases And Profiles

Use this reference when configuring target shortcuts or per-environment target variants.

## Profiles

Profiles are named variants of a target. They can override fields such as `args`, `url`, `env`, `headers`, and metadata.

```sh
clip profile add mygh work --env "GH_TOKEN=${GH_TOKEN_WORK}"
clip profile add mygh personal --env "GH_TOKEN=${GH_TOKEN_PERSONAL}"
clip profile use mygh work
clip mygh pr list
clip mygh@personal pr list
clip profile list mygh
clip profile unset mygh
clip profile remove mygh personal
```

Profile commands:

```sh
clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]
clip profile remove <target> <profile>
clip profile list <target>
clip profile use <target> <profile>
clip profile unset <target>
clip <target>@<profile> <args>
```

Merge behavior:

- Scalar and array fields such as `args`, `url`, `command`, and `address` are replaced by the profile value.
- Map fields such as `env`, `headers`, and `metadata` are merged on top of the target value; profile wins.
- ACL fields are target-level only. Profiles cannot bypass ACL.

## Aliases

Aliases define custom subcommand shortcuts on any target type.

```sh
clip alias add <target> <name> --subcommand <tool> [--arg X ...] [--args-json '[...]'] [--input-json '{...}'] [--description "..."]
clip alias remove <target> <name>
clip alias list <target>
clip alias show <target> <name>
```

Example:

```sh
clip alias add notion sprint --subcommand search_pages --arg "--query" --arg "sprint retro"
clip notion sprint
```

Aliases can also be edited directly in a target `config.yml`:

```yaml
aliases:
  sprint:
    subcommand: search_pages
    args: ["--query", "sprint retro"]
    description: "Search sprint retro pages"
  page:
    subcommand: get_page
    input:
      page_id: "$1"
    description: "Get page by ID"
```

Placeholders:

| Placeholder | Meaning |
|---|---|
| `$@` | all user args as individual tokens |
| `$*` | all user args joined with spaces |
| `$1`, `$2` | positional args |
| `${VAR}` | target env or process env |
| `$$` | literal `$` |

If an alias has no placeholder, user args are appended after the template.
