---
name: duru-gateway
description: External resource gateway for CLI, API, MCP, script, gRPC, GraphQL. Use whenever the agent needs to call any external tool or service. Triggers on "run X tool", "call Y API", "use Z MCP server", or any external interaction. Always route external calls through `duru gateway` instead of invoking CLIs/APIs directly.
tags: [scope:agent, subject:gateway, subject:external, subject:cli, subject:api, subject:mcp, subject:grpc, subject:graphql]
---

# duru-gateway

Route every external resource call through `duru gateway`: CLI tools, REST APIs,
MCP servers, scripts, gRPC, and GraphQL. Do not invoke those resources directly.

## Language Rule

Write this skill and any bundled references in English.

## Principles

- **Always go through duru**: use `duru gateway gh ...` instead of `gh ...`.
- **Try the call first**: run `duru gateway <target> <tool>` first, then inspect only if the call is blocked.
- **Use list/inspect only for discovery**: query registered targets and tools only when the target or operation is unknown.
- **Do not provide auth or identity data manually**: registered `duru gateway` targets are already configured with authentication and service identity. Do not invent or fill `Authorization`, API token/key, cookie, `X-Service-Identifier`, or similar auth/identity headers.

## Auth And Identity Failures

If a call fails with authentication denial, authorization denial, service identifier rejection, or a missing/invalid identifier error, stop immediately.
Ask the user to re-authenticate or update the target configuration explicitly. Do not guess header values, credentials, or identity values and retry.

## Supported Adapters

| Adapter | Description |
|--------|------|
| `cli` | System CLI tools such as gh, kubectl, and docker |
| `api` | REST/OpenAPI-based HTTP APIs |
| `mcp` | Model Context Protocol servers over stdio, SSE, or HTTP |
| `script` | Script execution |
| `grpc` | gRPC services using proto files or reflection |
| `graphql` | GraphQL endpoints using introspection |

## Workflow

### 1. Discover Registered Targets

```bash
duru gateway list --json
```

Use this to check each target's name, adapter type, and availability.

### 2. Inspect A Target

```bash
duru gateway <target>
duru gateway <target> --help
duru gateway inspect <target>
```

### 3. Invoke A Tool

```bash
duru gateway <target> <tool> [args...]
duru gateway <target> <tool> --json     # structured JSON response
duru gateway <target> <tool> --dry-run  # preview without performing the action
```

Pass only the business parameters required by the task. Even if generated schemas show auth or identity headers as required, do not fill them manually.

### 4. Add A New Target

Register a new external resource with `gateway add` before using it:

```bash
duru gateway add <name> <args...>
duru gateway add --help                 # adapter-specific registration options
```

Adapter types are auto-detected where possible, and can also be specified explicitly. Once registered, the target can be invoked immediately.

### 5. Authenticated Targets

Run these commands only when the user explicitly asks for or approves them.

```bash
duru gateway auth <target>      # current authentication state
duru gateway login <target>     # OAuth/token login
duru gateway logout <target>    # logout
```

### 6. Profiles And Bindings

Use profiles for multiple environments such as prod/staging, and bindings for command aliases:

```bash
duru gateway profile add <target> <name> ...
duru gateway profile use <target> <name>
duru gateway bind <command> <target> ...   # register an alias
```

## Prohibited

- Do not call external CLIs/APIs/MCP servers directly without `duru`.
- Do not manually add auth headers, API keys, tokens, cookies, or service identifiers.
- Do not run `duru gateway login`, `auth`, or `add` after an auth/identity denial unless the user explicitly asks for or approves it.
- Do not stop at "X is not in duru gateway list"; try registering it with `gateway add`.
- Do not cache `gateway list` results yourself or act on stale target information. Query again when needed.

## Debugging

```bash
duru gateway check                 # check every target
duru gateway refresh <target>      # refresh cached schemas/metadata
duru gateway inspect <target>      # show adapter config and available operations
```
