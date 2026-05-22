# Core Framework P0 Feature Design

Status: Draft
Date: 2026-05-22

## Summary

The core framework should move toward a single-source command declaration model. A command should be able to declare its positional params, options, validation rules, transforms, help metadata, and action input types from composable command features instead of repeating the same shape across `command("...")`, `.option(...)`, and a separate validator.

The highest-priority design target is:

```ts
import { z } from "@clip/input-zod";

cli
  .command(
    "call",
    z({
      params: {
        operation: z.string().min(1),
      },
      options: {
        timeoutMs: z.coerce.number().int().positive().default(30000),
      },
    }),
  )
  .action((ctx) => {
    ctx.params.operation; // string
    ctx.options.timeoutMs; // number
  });
```

This keeps the Hono-style validation pipeline, the Express-style composable router and middleware model, and the Commander/CAC-style CLI ergonomics in one framework contract.

## Current Context

The current framework already has these core pieces:

- `createCli()` with global options, middleware, plugins, events, renderers, and command registration.
- `createRouter()` with nested named routers, router-level middleware, route options, route presenters, and help route collection.
- Type inference for command params from command patterns and options from option specs.
- Renderer selection and command-level format presenters.
- Basic help, error, and not-found handling.

The main P0 gap is that command shape is spread across multiple declarations. A command author currently has to declare params in the command pattern, options in `.option()`, command metadata in separate help-facing APIs, and runtime validation somewhere else. That creates drift between help text, runtime behavior, plugin contracts, and TypeScript types.

## Design Principles

1. Core stays small and schema-library agnostic.
2. Command features passed to `command(...)` become the primary source of truth for params, options, metadata, and validation.
3. Actions receive validated and transformed `ctx.params` and `ctx.options`.
4. Raw parsed input remains available for middleware, diagnostics, and advanced plugins.
5. Help, completion, validation errors, and renderers consume the same command metadata.
6. Existing pattern and `.option()` APIs remain as low-level compatibility APIs.

## P0 Work List

| Priority | Feature | Outcome |
| --- | --- | --- |
| P0-1 | Command input feature | `command("call", z({...}))` declares params, options, validation, transforms, and action types |
| P0-2 | Option schema 강화 | Supports defaults, required/optional values, variadic options, choices, env fallback, coerce/parse, conflicts, and implies |
| P0-3 | Command metadata model | Aliases, examples, usage override, hidden/deprecated flags, and group are first-class |
| P0-4 | Router mount/prefix model | Router composition separates router identity from explicit mount paths |
| P0-5 | Partial path middleware | Middleware can target a command subtree such as `use("target", middleware)` |
| P0-6 | Route-level error boundaries | Commands and routers can handle validation/action errors locally |
| P0-7 | Standard Result/Response model | Result, exit code, streams/render hint, events, validation, and errors share a stable contract |
| P0-8 | Official Zod adapter | Zod validates and transforms command input without becoming a core dependency |

Delivery anchor:

1. Start with P0-5 partial path middleware, because it forces the router to make command path tokens and middleware boundaries explicit.
2. Then implement P0-1 command input feature on top of that command middleware/feature pipeline.
3. Then implement P0-8 official Zod adapter as the first concrete input feature.
4. Fit the remaining P0 items around those steps as supporting infrastructure, without blocking the first middleware milestone on the full metadata/help/completion model.

## P0-1: Command Input Feature

Add command input as a first-class command feature. The preferred public shape is `command("call", z({...}))`, where the second argument behaves like a command-building middleware that contributes params, options, validation, transforms, and action context types.

`.input(...)` can still exist as a builder method for composition, but it should be implemented as the same feature under the hood:

```ts
cli.command("call", z({...})).action(...);
cli.command("call").input(z({...})).action(...); // equivalent low-level form
```

Conceptual core type:

```ts
type CommandFeature<TParams extends object = object, TOptions extends object = object> = {
  kind: "clip.command_feature";
  input?: InputDefinition<TParams, TOptions>;
  metadata?: Partial<CommandMetadata>;
  middleware?: Middleware[];
};

type InputDefinition<TParams extends object, TOptions extends object> = {
  params?: ParamDefinition[];
  options?: OptionDefinition[];
  parse(input: RawCommandInput): Awaitable<ParsedCommandInput<TParams, TOptions>>;
};
```

Command builder behavior:

- `command("call", z({...}))` can generate the effective pattern `call <operation>` from `params.operation`.
- `command("call").input(z({...}))` remains valid as the same command feature in builder form.
- `input.options.timeoutMs` can generate `--timeout-ms <value>`.
- Required params become `<name>`.
- Optional params become `[name]`.
- Array params become rest params when explicitly marked as positional rest.
- Boolean options become flags.
- Non-boolean options become value options.
- Defaulted schema fields become optional CLI inputs with defaulted validated output.
- Multiple command features can be composed, but conflicting generated params/options fail at registration time.

Action context behavior:

```ts
ctx.params; // validated and transformed params
ctx.options; // validated and transformed options
ctx.raw.argv; // original argv
ctx.raw.params; // raw matched params before validation
ctx.raw.options; // raw parsed options before validation
ctx.raw.positionals; // raw positionals after option parsing
```

The important rule is that action handlers should usually read `ctx.params` and `ctx.options`, while middleware and diagnostics can inspect `ctx.raw`.

## P0-2: Option Schema 강화

The framework needs richer internal definitions than the current boolean/value option model.

Required option definition capabilities:

- `name`
- `aliases`
- `type`: boolean, string, number, integer, enum, array, unknown
- `required`
- `defaultValue`
- `valueName`
- `description`
- `hidden`
- `deprecated`
- `repeatable`
- `choices`
- `negatable`
- `env`
- `conflicts`
- `implies`
- `parseHint`
- `parser`
- `coerce`

Required param definition capabilities:

- `name`
- `required`
- `rest`
- `description`
- `valueName`
- `choices`
- `parseHint`
- `parser`
- `coerce`

The schema adapter can fill what it knows and leave optional metadata empty. Core should provide stable defaults:

- `timeoutMs` maps to `--timeout-ms`.
- `operation` maps to `<operation>`.
- A boolean option maps to `--name`.
- A defaulted or optional field is not required.
- A required field without default is required.
- Repeated options preserve all raw values before validation.
- Conflicts and implies are checked before action execution and return structured validation errors.
- Env fallback is represented as option metadata and can be populated by an env/config plugin before validation.

Optional UX metadata should be supported without forcing duplication:

```ts
z({
  params: {
    operation: z.string().describe("Operation name"),
  },
  options: {
    timeoutMs: z.option(z.coerce.number().int().positive().default(30000), {
      alias: "-t",
      valueName: "ms",
      description: "Timeout in milliseconds",
    }),
  },
});
```

This metadata is additive. The schema still owns the type and validation rule.

## P0-3: Command Metadata Model

Command metadata should become a stable internal object instead of being scattered across pattern strings and descriptions.

The metadata surface should be registry-backed so core fields and plugin fields use the same shape. Core defines the built-in keys in `CommandMetaFields`, exposes `CommandMeta` as the partial command meta object, and lets plugins extend `CommandMetaFields` through declaration merging.

Required command metadata:

- `name` or literal command path
- `description`
- `usage`
- `aliases`
- `examples`
- `group`
- `hidden`
- `deprecated`
- `params`
- `options`
- `input`
- `presenters`

Expected API shape:

```ts
cli
  .command(
    "call",
    {
      description: "Call an operation",
      aliases: ["run"],
      usage: "clip call <operation> [options]",
      group: "Operations",
      examples: ["clip call list-items --timeout-ms 3000"],
    },
    z({...}),
  )
  .action(...);
```

This metadata should drive:

- help text
- command-level help
- shell completion
- diagnostics
- documentation generation
- plugin inspection

Existing `command(pattern, description)` should remain valid and be normalized into this metadata shape.

Plugin-specific metadata should be handled by a composition-time command composer, not runtime middleware. A composer runs once when route entries are finalized and can validate metadata, attach route aliases, attach route middleware, or merge derived metadata:

```ts
declare module "@clip/core" {
  interface CommandMetaFields {
    auth: { scope: string };
  }
}

createPlugin((api) => {
  api.compose((command, next) => {
    const auth = command.meta.auth;
    if (auth) command.use(async (ctx, next) => {
      ctx.var.authScope = auth.scope;
      return next();
    });

    next();
  });
});
```

After a route matches, `ctx.meta` should expose the matched command metadata to middleware and actions.

## P0-4: Router Mount/Prefix Model

Named routers already provide a namespace-like model. The missing piece is an explicit mount boundary, similar to Express and Hono.

Expected API shape:

```ts
const target = createRouter({ name: "target-tools" });

target.command("tools").action(...);

cli.mount("target", target);
```

Router-level equivalent:

```ts
const parent = createRouter();
parent.mount("registry", registryRouter);
```

Required behavior:

- Mount path contributes literal command tokens.
- Router `name` remains identity/metadata, not necessarily the command prefix.
- Help and completion show mounted commands under the prefix.
- Type inference carries router options and context values across mount boundaries.

The existing `createRouter({ name })` API can remain as a convenience, but explicit `mount(prefix, router)` should be the clearer composition primitive.

## P0-5: Partial Path Middleware

Support Express-like path-scoped middleware for command subtrees.

Expected API shape:

```ts
cli.use("target", authMiddleware);
router.use("registry", registryMiddleware);
```

Required behavior:

- Prefix middleware runs only when the command path starts with the mounted prefix.
- Prefix middleware runs before child router middleware and command middleware.
- Prefix middleware participates in the same typed context flow as ordinary middleware.
- Help and command discovery are not affected by middleware-only prefixes.
- Middleware prefix matching uses command path tokens, not raw string prefix matching.

## P0-6: Route-Level Error Boundaries

Global `onError` is not enough once routers become feature modules. Routers and commands need local error handling.

Expected API shape:

```ts
router.onError((ctx) => {
  return ctx.exit(1, {
    error: { message: "Operation failed" },
  });
});

cli
  .command("call", z({...}))
  .catch((ctx) => {
    return ctx.exit(1, {
      error: { message: "Call failed" },
    });
  });
```

Required behavior:

- Command-level handlers run before router-level handlers.
- Nearest router boundary runs before parent router boundaries.
- Global `cli.onError` remains the final fallback.
- Validation errors can be handled by the same boundary model but keep their default exit code `2` unless overridden.
- A `finally`-style cleanup hook is out of P0 unless implementation reveals that error boundaries cannot cleanly release resources without it.

## P0-7: Standard Result/Response Model

The framework currently accepts arbitrary action return values and renderer-specific presenters. That flexibility should remain, but core should standardize common control-flow results.

Required result kinds:

```ts
type CommandResponse<T = unknown> = {
  ok: boolean;
  exitCode: number;
  result: T;
  value?: unknown;
  stdout?: string;
  stderr?: string;
  render?: {
    format?: string;
    presenters?: ReadonlyMap<string, RoutePresenter<unknown>>;
  };
  events: readonly CliEventRecord[];
};

type CommandResult<T = unknown> =
  | { kind: "clip.ok"; value: T; exitCode?: number }
  | { kind: "clip.exit"; ok: boolean; exitCode: number; result: T }
  | { kind: "clip.validation_error"; issues: ValidationIssue[]; source: "params" | "options" | "input" }
  | { kind: "clip.not_found"; argv: readonly string[]; message: string }
  | { kind: "clip.error"; error: unknown; message: string };
```

Validation issue shape:

```ts
type ValidationIssue = {
  path: readonly string[];
  code: string;
  message: string;
  expected?: string;
  received?: unknown;
};
```

Renderer behavior:

- Text renderer prints concise human-readable validation errors.
- JSON renderer emits stable structured errors.
- Route presenters can still override successful action values.
- Error presenters should be generated from standard result kinds.
- Plugins can inspect one response envelope instead of interpreting renderer internals.

## P0-8: Official Zod Adapter

Add an official package such as `@clip/input-zod`.

Preferred DX:

```ts
import { z } from "@clip/input-zod";

cli.command(
  "call",
  z({
    params: {
      operation: z.string().min(1),
    },
    options: {
      timeoutMs: z.coerce.number().int().positive().default(30000),
    },
  }),
).action(...);
```

The adapter should export a callable `z` helper that behaves like the Zod namespace for schema construction and also accepts a command input object. It should also export `zodInput(...)` as an explicit alias for cases where overloaded `z(...)` hurts readability.

Adapter responsibilities:

- Convert Zod object fields into core param and option definitions.
- Validate raw params and options before action execution.
- Apply Zod transforms and defaults.
- Convert Zod issues into the core validation error model.
- Preserve typed inference through `command("name", z({...}))` and `CommandBuilder.input(...)`.

Core responsibilities:

- Run input parsing after route matching and raw option parsing, before matched router, command middleware, and the action run.
- Replace `ctx.params` and `ctx.options` with validated values before calling the action.
- Store raw values under `ctx.raw`.
- Return a structured validation error with exit code `2` when input parsing fails.

## Compatibility And Migration

Existing APIs remain valid:

```ts
cli
  .command("call <operation>")
  .option("--timeout-ms <ms>")
  .action(...);
```

Mixed mode is allowed:

```ts
cli
  .command(
    "call <operation>",
    z({
      params: {
        operation: z.string().min(1),
      },
      options: {
        timeoutMs: z.coerce.number().int().positive().default(30000),
      },
    }),
  )
  .option("--timeout-ms <ms>")
  .action(...);
```

In mixed mode:

- Existing pattern and option specs define the raw parse surface.
- Command input features validate and transform those raw values.
- If the schema defines a param or option that the command did not declare, core can generate it.
- If both declare the same field, core checks for compatibility and throws a registration-time error for conflicts.

## Testing Requirements

Core tests:

- `command("name", z({...}))` infers transformed `ctx.params` and `ctx.options`.
- `.input(z({...}))` remains equivalent to passing the input feature to `command(...)`.
- Schema-derived params are matched as command positionals.
- Schema-derived options are parsed from CLI flags.
- Defaults and transforms are applied before action execution.
- Raw values are preserved in `ctx.raw`.
- Validation failure skips action execution and returns exit code `2`.
- Help includes schema-derived params and options.
- Completion metadata includes schema-derived params and options.
- Mixed mode detects incompatible duplicate declarations.
- Existing command pattern and `.option()` tests keep passing.

Zod adapter tests:

- Zod object schemas generate expected core definitions.
- `z.coerce.number()` transforms option strings into numbers.
- `z.default()` makes fields optional at CLI parse time.
- Zod validation issues map to stable validation issues.
- Optional metadata from `z.option(...)` appears in help definitions.

Router/error tests:

- Prefix-mounted middleware runs only for matching subtrees.
- Nested router error boundaries run nearest-first.
- Command-level `.catch()` overrides router/global error handlers.
- Validation errors can be handled locally.

## Non-Goals

- Core should not depend on Zod directly.
- Core should not make every schema library expose the same metadata depth.
- Arbitrary third-party command-builder method extension is not P0.
- Full documentation generation can wait until command metadata is stable.
- Shell-specific completion rendering can be implemented after metadata and completion model are defined.

## Design Decisions

1. The official Zod adapter should expose callable `z(...)` as the preferred API and also export `zodInput(...)` as an explicit alias.
2. Array params should not automatically become rest positionals. Rest behavior must be explicit through adapter metadata such as `z.rest(...)` or an equivalent option.
3. Env fallback belongs in the core option definition as metadata, but reading env/config values can be handled by plugins before validation.
4. `ctx.raw.argv` is available from context creation. `ctx.raw.params`, `ctx.raw.options`, and `ctx.raw.positionals` are populated after route matching and raw option parsing.
5. `command(...)` should accept variadic command features after the path: metadata objects, input definitions, and future command-level feature objects can compose without reserving the second argument for only one concern.

## Recommended Implementation Order

1. Add minimal route metadata needed for execution: literal command path tokens, mounted path tokens, route middleware stacks, and parent/child route scopes.
2. Implement P0-5 partial path middleware with token-based prefix matching and tests for `cli.use("target", middleware)` and `router.use("registry", middleware)`.
3. Add the minimal P0-4 mount/prefix support needed by partial middleware, keeping full router identity/help behavior for later in the same P0 pass.
4. Add `ctx.raw` and preserve raw argv, raw params, raw options, and raw positionals through route matching.
5. Implement P0-1 core command feature contract and support `command("name", feature)` plus `.input(feature)`.
6. Add schema-derived params/options with registration-time conflict checks.
7. Add the minimal P0-7 validation result path so input failures return a stable structured result with exit code `2`.
8. Implement P0-8 `@clip/input-zod` as the first official command input feature.
9. Expand P0-2 option and param schemas around real adapter needs: default, required/optional value, variadic/repeatable, choices, env metadata, coerce/parse, conflicts, and implies.
10. Complete P0-3 command metadata and update help to read command metadata, option schemas, aliases, usage overrides, hidden/deprecated flags, groups, and examples.
11. Finish P0-4 router mount/prefix behavior for help, completion metadata, and router identity.
12. Add P0-6 command/router-level error boundaries.
13. Complete the remaining P0-7 response envelope work for render hints, stdout/stderr, events, and plugin inspection.
14. Add completion metadata once help metadata is stable.
