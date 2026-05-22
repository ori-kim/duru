# @clip/cli-gateway Design

Date: 2026-05-22
Status: Draft for review

## Purpose

`@clip/cli-gateway` is the package that owns Clip's target gateway feature. It packages the runtime, protocol adapters, target store, and target-facing commands into one installable CLI plugin.

The package exists because the target system is not a generic CLI framework concern. It is a product feature: register external tools and protocols, apply policy, route invocations, and expose management commands such as `add`, `list`, `remove`, `login`, `logout`, and `profile`.

## Goals

- Provide a `cliGateway()` plugin that can be installed into `@clip/core`'s CLI framework.
- Own target gateway commands: add, list, remove, refresh, login, logout, profile, alias, bind, unbind, and binds.
- Own target invocation routing: `clip <target> <subcommand> [...args]`.
- Include the default adapters for CLI, MCP, OpenAPI REST, GraphQL, gRPC, and script targets.
- Keep runtime, adapter, and command code internally separated while shipping them as one semantic package.
- Use `@clip/config` only for home/layout/file-store primitives.
- Preserve a path to existing target layouts where practical.
- Allow future external adapters through a stable adapter interface.

## Non-Goals

- No app update command. `clip update` is distribution-level behavior.
- No general app plugin installer. Extension installation belongs to a plugin platform package.
- No skills registry. Skills are a separate product feature.
- No secure token backend in this package. Auth adapters may depend on a separate auth package.
- No broad framework APIs that belong in `@clip/core`.

## Package Shape

```text
packages/cli-gateway/
  src/index.ts
  src/plugin.ts
  src/runtime/
  src/store/
  src/commands/
  src/adapters/
    cli/
    mcp/
    openapi/
    graphql/
    grpc/
    script/
  src/output/
  src/types.ts
```

The package can expose subpath exports later, but the primary public surface is:

```ts
import { cliGateway, defaultGatewayAdapters } from "@clip/cli-gateway";

createCli({ name: "clip" }).use(
  cliGateway({
    home,
    adapters: defaultGatewayAdapters(),
  }),
);
```

## Internal Boundaries

### Store

The store owns target-system data and uses `@clip/config` for file IO.

Responsibilities:

- Load and save target configs.
- Load target-local `.env` files.
- Resolve target names across types.
- Manage profiles.
- Manage aliases.
- Manage bind metadata if bind state is file-backed.
- Preserve storage compatibility when configured.

The store knows target/profile/alias schemas. `@clip/config` does not.

Recommended compatibility layout:

```text
$CLIP_HOME/target/<type>/<name>/config.yml
$CLIP_HOME/target/<type>/<name>/.env
```

The first version should preserve this layout unless there is a concrete reason to migrate.

### Runtime

The runtime owns invocation execution.

Responsibilities:

- Parse target invocations.
- Resolve target plus optional profile.
- Expand target aliases.
- Apply ACL and command policy.
- Run lifecycle hooks.
- Call the selected adapter.
- Apply timeout and abort signals.
- Return a `GatewayResult`.
- Render or hand off output through the configured renderer.

The runtime does not read or write files directly. It uses the store interface.

### Adapters

Adapters implement target-type behavior.

```ts
type GatewayAdapter<TConfig = unknown> = {
  type: string;
  schema: GatewaySchema<TConfig>;
  detect?(input: AddInput): boolean | Promise<boolean>;
  add?(input: AddInput): Promise<TConfig>;
  normalize?(config: TConfig, ctx: NormalizeContext): TConfig | Promise<TConfig>;
  execute(config: TConfig, ctx: ExecuteContext): Promise<GatewayResult>;
  describeTools?(config: TConfig, ctx: DescribeContext): Promise<readonly GatewayTool[] | null>;
  refresh?(config: TConfig, ctx: RefreshContext): Promise<TConfig | void>;
  login?(config: TConfig, ctx: AuthContext): Promise<void>;
  logout?(config: TConfig, ctx: AuthContext): Promise<void>;
  listRow?(config: TConfig, ctx: ListContext): Promise<GatewayListRow>;
  completion?(): string;
};
```

Default adapters:

- `cli`: local CLI execution and passthrough.
- `mcp`: HTTP, SSE, and stdio MCP servers.
- `openapi`: OpenAPI REST operation discovery and execution.
- `graphql`: introspection, query, and mutation execution.
- `grpc`: protobuf or reflection-based service calls.
- `script`: named scripts stored as a target.

### Commands

Gateway commands are product commands for the target system.

Included:

- `clip add <name> ...`
- `clip list`
- `clip remove <name>`
- `clip refresh <target>`
- `clip login <target>`
- `clip logout <target>`
- `clip profile add/use/list/remove/unset ...`
- `clip alias add/list/remove ...`
- `clip bind <target>`
- `clip unbind <target>`
- `clip binds`

Target subcommands are routed by the runtime:

- `clip <target> tools`
- `clip <target> describe <operation>`
- `clip <target> types`
- `clip <target> <operation> [...args]`

Commands that should stay outside the package:

- `clip update`
- `clip ext ...`
- `clip skills ...`

`completion` can be split: the app owns the top-level command, and `@clip/cli-gateway` contributes target and adapter completions.

## Public API

```ts
type CliGatewayOptions = {
  home: ClipHome;
  adapters?: readonly GatewayAdapter[];
  compatibility?: {
    targetLayout?: "legacy" | "scoped";
  };
  output?: GatewayOutputOptions;
};

declare function cliGateway(options: CliGatewayOptions): CliPlugin;
declare function defaultGatewayAdapters(): readonly GatewayAdapter[];
```

Adapter-authoring types should be public:

```ts
export type {
  GatewayAdapter,
  GatewayResult,
  GatewayTool,
  GatewayStore,
  AddInput,
  ExecuteContext,
  AuthContext,
};
```

Runtime internals should not be public unless a real extension use case appears.

## Core Integration

`@clip/cli-gateway` needs a way to run target invocations after ordinary commands fail to match. There are two acceptable integration designs:

1. Add a core fallback hook that plugins can register for unmatched argv.
2. Let gateway install terminal middleware that can observe whether a route handled the request.

The fallback hook is cleaner because target routing is not a normal literal command. The hook can receive argv, parsed global options, and a way to return a handled result.

## Invocation Flow

```text
argv
  -> core parses global options
  -> gateway fallback receives unmatched argv
  -> gateway parser identifies target token and profile
  -> store loads target config
  -> store merges active and explicit profile
  -> runtime expands aliases
  -> runtime checks ACL
  -> runtime runs subcommand-start hooks
  -> adapter executes operation
  -> runtime runs subcommand-end or error hooks
  -> output renderer writes result
```

For example:

```text
clip test-service getItem --id 1 --json
```

resolves `test-service`, selects its adapter, executes `getItem`, and renders JSON.

## Data Model

Target config stays adapter-owned but shares common fields:

```ts
type GatewayTargetBase = {
  type: string;
  allow?: readonly string[];
  deny?: readonly string[];
  acl?: AclTree;
  aliases?: Record<string, GatewayAlias>;
  profiles?: Record<string, GatewayProfile>;
  timeoutMs?: number;
};
```

Adapter configs extend this base. Examples must use generic names such as `test-service`, `catservice`, `api.example.com`, and `dummy-token`.

## Error Handling

- Target not found returns a stable CLI error with a `clip list` hint.
- Unknown target type returns an adapter registration error.
- Invalid config reports the target name and config path.
- ACL denial is distinct from adapter failure.
- Adapter failures preserve exit code when available.
- Validation failures should be renderable as structured JSON.
- Hook failures should fail the invocation unless the hook is marked best-effort.

## Testing

Unit tests:

- Store load/save with temporary homes.
- Target resolution across types.
- Profile merge precedence.
- Alias expansion.
- ACL allow/deny decisions.
- Adapter detection order.
- Command parsing for add/list/remove/login/logout/profile/alias.
- Runtime dispatch with fake adapters.
- Output selection for plain and JSON.

Integration tests:

- Register a CLI target and execute a harmless command.
- Register an OpenAPI target fixture and run `tools` and one operation.
- Register an MCP fixture and run `tools`.
- Verify `clip <target>@<profile> ...`.
- Verify `clip <target> describe ...`.

## Adoption Plan

1. Add `@clip/config`.
2. Add `@clip/cli-gateway` with store and fake adapter tests.
3. Add core fallback support if the current middleware API cannot cleanly route unmatched target invocations.
4. Port CLI target support first.
5. Add add/list/remove/profile/alias commands.
6. Port MCP adapter.
7. Port OpenAPI, GraphQL, gRPC, and script adapters.
8. Add login/logout and refresh once auth and adapter refresh contracts are stable.
9. Reconnect the `clip` app as composition over `@clip/core`, renderers, `@clip/config`, and `@clip/cli-gateway`.

## Review Notes

The package intentionally combines runtime, adapters, and target commands because they all serve one product capability: CLI gateway targets. The internal folder boundary keeps the code understandable while avoiding premature package fragmentation.
