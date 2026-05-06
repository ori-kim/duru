# Clip Target Types

Use this reference when running or understanding clip targets.

## Universal Target Commands

```sh
clip <target> <subcommand> [...args]
clip <target> tools
clip <target> describe <op>
clip <target> types
clip <target> --help
```

Use `tools`, `describe`, or `--help` before guessing args.

## CLI Targets

Wraps a local command with clip ACL rules.

```sh
clip gh issue list
clip gh pr list --json-output
```

## MCP Targets

Supports HTTP Streamable HTTP, legacy SSE, or STDIO MCP servers.

```sh
clip notion search --query "design doc"
clip login notion
```

Transport types:

- `http`: default Streamable HTTP endpoint.
- `sse`: legacy SSE transport with `GET /sse` and `POST /messages`.
- `stdio`: local process through stdin/stdout.

## OpenAPI REST Targets

Runs operations from an OpenAPI spec.

```sh
clip petstore getPetById --petId 1
clip petstore getPetById --petId 1 --dry-run
```

## gRPC Targets

Requires `grpcurl` in `PATH`.

```sh
clip my-api tools
clip my-api UserService.GetUser --id 123
clip my-api describe UserService.GetUser
clip my-api types
```

## GraphQL Targets

Uses introspection-based queries, mutations, subscriptions, and raw queries.

```sh
clip gql tools
clip gql getUser --id 123
clip gql query --query '{ users { id } }'
clip gql describe User
```

## Script Targets

Bundles named shell scripts as a clip target.

```sh
clip my-scripts tools
clip my-scripts deploy production
clip my-scripts deploy --help
```

Script targets can also support dry-run:

```sh
clip my-scripts deploy production --dry-run
```

## Output Modes

```sh
clip <target> <subcommand> --json-output
clip <target> <subcommand> --pipe
```

- `--json-output`: output JSON when supported; unwraps MCP content and wraps CLI stdout.
- `--pipe`: force buffered mode and disable passthrough.
