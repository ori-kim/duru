# Manage Clip Targets

Use this reference when adding, removing, refreshing, authenticating, binding, listing, or configuring clip targets.

## List And Inspect

```sh
clip list
clip <target> --help
clip <target> tools
clip <target> describe <op>
clip <target> types
```

## Add Targets

```sh
clip add <name> <cmd>
clip add <name> <https://...mcp>
clip add <name> --sse <https://...sse>
clip add <name> --stdio <cmd> [args...]
clip add <name> <https://.../openapi.json>
clip add <name> <host:port> --grpc [proto]
clip add <name> <https://.../graphql> --graphql
clip add <name> --script
```

If adding a target could expose sensitive access, set an ACL immediately in the target config.

## Remove And Refresh

```sh
clip remove <name>
clip refresh <target>
```

`remove` is destructive. Confirm the target name and user intent before running it.

## Login And Logout

```sh
clip login <target>
clip logout <target>
```

Use `clip login <target>` for OAuth-enabled MCP/API targets after auth errors or expired tokens.

## Native Binds

```sh
clip bind <target>
clip binds
clip unbind <target>
```

`clip bind gh` creates a shim so the native command name routes through clip. Make sure the user's shell `PATH` points to the clip bind directory before other command locations.

## Profiles

Basic profile management:

```sh
clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]
clip profile use <target> <profile>
clip profile list <target>
clip profile unset <target>
clip profile remove <target> <profile>
```

For detailed profile behavior and alias commands, read `aliases-profiles.md`.
