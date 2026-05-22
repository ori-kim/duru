# Core Framework P0 Implementation History

Date: 2026-05-22
Feature spec: `docs/superpowers/specs/2026-05-22-core-framework-p0-design.md`
Stack base at start: `codex/typed-context-expansion`

## Stack Plan

The P0 work is being implemented as a sequential Graphite stack. The first delivery anchor is partial path middleware because it forces route matching, command path tokens, and middleware boundaries to become explicit before command input features are added.

Planned order:

1. `codex/p0-partial-path-middleware`
2. P0-1 command input feature branch
3. P0-8 official Zod adapter branch
4. Remaining P0 support branches for command metadata, mount/prefix completion, error boundaries, and response envelope work

## Step 1: Partial Path Middleware

Branch: `codex/p0-partial-path-middleware`
Parent: `codex/typed-context-expansion`
Status: implemented, subagent review addressed

### Intent

Add Express-style path-scoped middleware to the core CLI framework:

- `cli.use("target", middleware)` should run only for CLI command subtrees whose positional command path starts with `target`.
- `router.use("registry", middleware)` should run only for nested router routes under `registry`.
- Router path middleware should run before matching child router middleware so parent routers can guard child subtrees.

### Files Changed

- `core/framework/src/cli/index.ts`
- `core/framework/src/router/index.ts`
- `core/framework/src/types/cli.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`

### Tests Added

- `runs cli path middleware only for matching command subtrees`
- `runs cli path middleware when route options precede the command path`
- `runs cli path middleware using matched route options when aliases conflict`
- `does not run cli path middleware for param values that match the scoped path`
- `matches cli path middleware against the selected route when later routes share literals`
- `does not collapse params when matching cli path middleware prefixes`
- `matches cli path middleware using plugin router order before default routes`
- `does not let default route literals trigger cli path middleware for earlier plugin param routes`
- `runs router path middleware before matching child router middleware`
- `runs multi-token router path middleware before matching child router middleware`
- `preserves router scoped middleware order relative to ordinary middleware`
- `keeps router-installed options available to root commands`
- `preserves router use ordering before later cli middleware`
- `carries option types through path scoped middleware`

### Verification

- `bun test core/framework/src/cli.test.ts`
- `bun test`
- `bunx tsc --noEmit`
- `bun run lint`

All verification commands passed before review.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- Spec compliance review found that `cli.use("target", middleware)` could be bypassed when a route-local option appeared before the command path, because the first implementation checked `ctx.request.positionals` before route-specific option parsing.
- Code quality review found the same bypass and also found that multi-token router scoped middleware such as `router.use("registry add", middleware)` could run after child router middleware.

Both issues were fixed by:

- Making CLI path middleware parse command positionals with all known route option definitions instead of only global options.
- Keeping `cli.use(router)` on the existing plugin install path, preserving router option registration and middleware registration ordering.
- Running scoped router middleware as route-pattern-aware wrappers at the router scope where they were registered, before child router middleware.
- Adding regression tests for route-local options before command paths and multi-token router scoped middleware ordering.

A second re-review found two compatibility regressions in the intermediate fix and one remaining ordering issue:

- Router options were no longer installed globally when `cli.use(router)` was intercepted before plugin installation.
- `cli.use(router)` middleware ordering changed when routers were mounted into the default router instead of installed as plugins.
- Router scoped middleware did not preserve call order relative to ordinary router middleware.

These were fixed by:

- Restoring generic router plugin installation in `cli.use(router)`.
- Adding compatibility tests for router-installed options on root commands and router use ordering before later CLI middleware.
- Replacing the router's split `middleware` and `scopedMiddleware` arrays with one ordered middleware stack.
- Resolving scoped middleware to pattern-aware wrappers during route collection while preserving registration order.

A final review found that CLI path-scoped middleware still matched parsed positionals rather than matched literal route tokens. That allowed two edge cases:

- Duplicate route-local option aliases could confuse prefix detection.
- A positional parameter value equal to the scoped path could trigger middleware even when the literal command subtree did not match.

These were fixed by:

- Matching CLI path middleware against collected route metadata.
- Evaluating each candidate route with that route's own option definitions.
- Comparing the scoped path only to literal tokens from the matched route pattern, not parameter values.
- Adding regression tests for duplicate aliases and parameter values equal to the scoped path.

A follow-up review found that the matcher considered any matching route instead of the first route selected by router order, and that removing params from the middle of a pattern could still make non-prefix literals look like a command prefix.

These were fixed by:

- Evaluating routes in help/route order and stopping at the first matching route.
- Comparing the scoped prefix against the leading pattern tokens of that selected route.
- Treating params and optional params as non-matching prefix positions instead of deleting them from the token stream.
- Adding regression tests for overlapping generic/literal routes and literals after params.

A final review found that help route order still differed from execution order when plugin routers and default router commands overlapped.

This was fixed by:

- Matching CLI path middleware against execution-ordered route providers: plugin router help routes first, default router routes last.
- Keeping display help order unchanged.
- Adding regression tests for plugin-router routes selected before overlapping default routes.

Verification after fixes:

- `bun run check`
- Final spec compliance subagent review: no spec compliance issues found.
- Final code quality subagent review: no important issues found.

The final verification passed with 51 tests.

## Step 2: Command Input Feature

Branch: `codex/p0-command-input-feature`
Parent: `codex/p0-partial-path-middleware`
Status: implemented, subagent review addressed

### Intent

Add a schema-library-agnostic command input feature that lets adapters declare params/options and transform parsed command input in one place before action handlers run.

The core API added in this step is intentionally not Zod-specific:

- `cli.command("call", input(...)).action(...)`
- `cli.command("call").input(input(...)).action(...)`
- input features can append command params to the route pattern.
- input features can add command options to route metadata and help.
- action contexts receive transformed `ctx.params` and `ctx.options`.
- action contexts can inspect original parsed values through `ctx.raw`.

### Files Changed

- `core/framework/src/input/index.ts`
- `core/framework/src/types/input.ts`
- `core/framework/src/router/index.ts`
- `core/framework/src/cli/index.ts`
- `core/framework/src/context/index.ts`
- `core/framework/src/options/index.ts`
- `core/framework/src/pattern/index.ts`
- `core/framework/src/types/cli.ts`
- `core/framework/src/types/context.ts`
- `core/framework/src/types/index.ts`
- `core/framework/src/types/options.ts`
- `core/framework/src/types/pattern.ts`
- `core/framework/src/types/route.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`

### Tests Added

- `derives command params and options from input features before actions`
- `supports builder input features as an equivalent command form`
- `uses input feature params and options in command help`
- `infers action params and options from command input features`

### Verification

Red check:

- `bun test core/framework/src/cli.test.ts core/framework/src/types.test.ts`
- Expected failure: `input` was not exported yet.

Green checks:

- `bun test core/framework/src/cli.test.ts core/framework/src/types.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run check`

The full verification passed with 55 tests.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- Spec compliance review found no issues against the P0-1 scope. It noted future hardening work around duplicate/conflict behavior and structured validation errors.
- Code quality review found three risks:
  - duplicate mixed-mode params/options could silently create runtime ambiguity and type/runtime drift;
  - input parse failures populated `onError` with the initial empty request/raw context instead of the matched command context;
  - public default `OptionValue`, `Options`, and `Params` aliases had been widened to `unknown`, which would break untyped consumers that rely on raw parser value types.

These were fixed by:

- Rejecting duplicate command input params and command options at registration time, including both `input(...).option(...)` and `.option(...).input(...)` order.
- Applying input features atomically so a rejected builder `.input(...)` cannot leave a parser, param, or option partially installed.
- Setting `ctx.raw`, `ctx.request`, `ctx.params`, and `ctx.options` to the matched raw command context before running input parsers, so `onError` can inspect raw matched input if parsing throws.
- Restoring public raw value aliases while loosening only the generic transformed context/action surface to allow adapter-produced values such as numbers.
- Adding regression tests for duplicate declarations, parse-failure context, composed input features, and default middleware source compatibility.

Verification after fixes:

- `bun test core/framework/src/cli.test.ts core/framework/src/types.test.ts`
- `bun run typecheck`
- `bun run lint`

Final review:

- Final spec compliance subagent review: no spec-compliance issues found.
- Final code quality subagent review: no important issues found.
- Minor residual notes for later hardening:
  - duplicate option definitions inside a single input feature array are still a possible adapter bug class;
  - `Context.raw` is now required on public context objects, so external hand-written context mocks may need updating.

## Step 3: Official Zod Adapter

Branch: `codex/p0-zod-adapter`
Parent: `codex/p0-command-input-feature`
Status: implemented, subagent review addressed

### Intent

Add `@clip/input-zod` as the first concrete command input adapter without adding Zod to `@clip/core`.

Target API:

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
);
```

### Files Changed

- `packages/input-zod/package.json`
- `packages/input-zod/src/index.ts`
- `packages/input-zod/src/index.test.ts`
- `core/framework/src/cli/result.ts`
- `core/framework/src/index.ts`
- `core/framework/src/result/index.ts`
- `core/framework/src/types/index.ts`
- `core/framework/src/types/result.ts`
- `tsconfig.json`
- `bun.lock`
- `docs/superpowers/history/2026-05-22-core-framework-p0-history.md`

### Tests Added

- `validates and transforms command params and options`
- `accepts z.object groups and boolean options`
- `supports explicit zodInput alias`
- `treats boolean transforms as flag options`
- `does not execute schemas while building command metadata`
- `treats preprocess-wrapped default params as optional without metadata side effects`
- `keeps required pipe params required when only the output accepts undefined`
- `rejects required params after optional params`
- `rejects duplicate generated option aliases`
- `contributes command params and options to help metadata`
- `maps validation failures to stable core validation issues`
- `preserves raw matched context when validation fails`
- `infers transformed action param and option types`

### Verification

Red check:

- `bun test packages/input-zod/src/index.test.ts`
- Expected failure: `@clip/input-zod` module did not exist yet.

Green checks:

- `bun test packages/input-zod/src/index.test.ts`
- `bun run typecheck`
- `bun run lint`
- `bun run check`

The full verification passed with 75 tests.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- Spec compliance review found no issues against the P0-8 scope.
- Code quality review found that Zod v4 boolean pipes/transforms were classified as value options instead of flags because the adapter did not inspect `_def.in`.
- Code quality review also noted the missing explicit `zodInput` alias.
- Final code quality re-review found that requiredness detection executed Zod schemas during command metadata construction.
- A follow-up focused review found that preprocess-wrapped default/optional params were still marked required because pipe optionality only inspected the input side.
- Final spec sanity review found that validation failures still exposed raw `ZodError` instead of the stable core validation error shape required by the P0 design.
- Final code quality review found two generated metadata edge cases: optional/default params before later required params could make the required param unreachable, and duplicate normalized option aliases inside one Zod feature were not rejected.

The accepted issues were fixed by:

- Exporting `zodInput` as the explicit adapter factory alongside overloaded `z`.
- Unwrapping Zod v4 pipe input schemas so `z.boolean().transform(...)` still generates `--flag`.
- Replacing `safeParse(undefined)` requiredness detection with metadata-only wrapper inspection, avoiding preprocess/default side effects during CLI startup and help generation.
- Inspecting both input and output sides of Zod v4 pipes for optional/default/catch wrappers so preprocess-wrapped default params can still match omitted positionals.
- Adding a minimal core `clip.validation_error` result shape with `ValidationIssue` records and default exit code `2`.
- Mapping Zod issues to that stable core validation error before they reach action handlers or global error fallback.
- Rejecting required generated params after optional generated params until the core matcher supports non-greedy/backtracking optional positionals.
- Rejecting duplicate generated option aliases inside one Zod input feature.
- Adding regression tests for the accepted fixes.
## Step 4: Command Metadata Model

Branch: `codex/p0-command-metadata`
Parent: `codex/p0-zod-adapter`
Status: implemented, subagent review addressed

### Intent

Add a shared command metadata model for help, completion, documentation, and plugin inspection:

- command aliases
- examples
- usage override
- hidden/deprecated flags
- group
- metadata-object command declarations
- command input feature metadata contributions

### Files Changed

- `core/framework/src/router/index.ts`
- `core/framework/src/help/index.ts`
- `core/framework/src/cli/index.ts`
- `core/framework/src/input/index.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/types/cli.ts`
- `core/framework/src/types/help.ts`
- `core/framework/src/types/input.ts`
- `core/framework/src/types/index.ts`
- `core/framework/src/index.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`
- `docs/superpowers/history/2026-05-22-core-framework-p0-history.md`

### Tests Added

- structured help documents include command metadata
- alias invocation routes to the same command action
- canonical CLI path middleware runs for alias invocations
- canonical router path middleware runs for alias invocations
- alias/canonical pattern collisions are rejected
- whitespace-normalized alias/canonical pattern collisions are rejected
- rejected aliases are not partially applied
- input features rejected by existing aliases are not partially applied
- list help hides hidden commands and annotates deprecated commands
- command help shows usage overrides, aliases, and examples
- mounted router usage overrides keep mount prefixes
- absolute mounted usage overrides are not prefixed twice
- mounted usage keeps repeated router/command literals
- command metadata object declarations work with command input features
- command input feature metadata contributes aliases/examples to help metadata
- extension command composers attach route middleware and aliases before routing
- command aliases are provided through the default command composer
- fluent metadata builder calls preserve action param and option inference
- command metadata object declarations preserve input feature param and option inference
- exported reusable `CommandConfig` values are accepted by `command()`
- reusable input-backed `CommandConfig<TParams, TOptions>` values preserve action inference

### Verification

Red checks:

- `bun test core/framework/src/cli.test.ts -t "command metadata"`
- Expected failure: command builder had no `.alias()` API.
- `bun run typecheck`
- Expected failure: command metadata builder methods and overloads did not exist.

Green checks:

- `bun test core/framework/src/cli.test.ts -t "command aliases|usage overrides|metadata objects|input features rejected"`
- `bun test core/framework/src/types.test.ts`
- `bun run check`

The full verification passed with 118 tests.

### Implementation Notes

- `CommandMetadata` is the shared metadata surface and is exported publicly.
- `CommandMetaFields` is the declaration-merging registry for command meta keys, and `CommandMeta`/`CommandMetadata` are derived from it.
- `HelpRoute` now carries command metadata in addition to pattern, description, and options.
- `CommandBuilder` gained `.meta()`, `.alias()`, `.aliases()`, `.example()`, `.examples()`, `.usage()`, `.hidden()`, `.deprecated()`, and `.group()`.
- `CommandConfig` allows `cli.command("call", { input, aliases, usage, ... })` without losing input-derived type inference.
- Exported reusable `CommandConfig` values can be passed to `command()` after widening, including input-backed configs with preserved params/options inference.
- `CommandInputDefinition` and `CommandFeature` can contribute metadata, so adapters can publish help/completion/documentation metadata through the same model.
- Plugins can augment `CommandMetaFields` and register `api.compose((command, next) => ...)` composers that run once per matching route during registry finalization.
- `ctx.meta` exposes the matched route metadata to middleware and actions.
- Command composers receive a command draft with readonly `meta`/`options` and helpers for adding route aliases, route middleware, or derived meta.
- Command aliases are provided by the default `commandAliases()` composer rather than direct router behavior.
- Alias patterns can be declared as literal aliases such as `rm`, which inherit the canonical command params, or as explicit full alias patterns with the same param signature.
- Alias/canonical collisions in the same router are rejected during registration.
- Pattern collision checks normalize whitespace before comparison.
- Rejected alias or input-feature updates validate before mutating the route.
- Path-scoped middleware matches the selected route's canonical pattern and aliases, so alias invocations do not bypass canonical scoped middleware.
- Help list output omits hidden commands, groups commands by group when present, and keeps the old flat output when no groups are defined.
- Command-level help supports usage override, aliases, examples, and deprecation notes.
- Mounted router usage overrides are normalized relative to the mount path unless the override is already absolute.
- Mounted usage overrides keep repeated router/command literals instead of treating any mount-prefix-looking local usage as already mounted.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- Both reviews found that alias invocations bypassed canonical path-scoped middleware.
- One review found that alias/canonical collisions could make routing disagree with help output.
- Reviews found that mounted router usage overrides could double-prefix absolute usage strings.
- One review found that rejected input features could partially mutate routes when explicit aliases already existed.
- One review noted that the metadata API needed metadata-object command declarations and command feature metadata, not only fluent builder methods.
- Re-review found that collision checks missed existing canonical patterns with different whitespace.
- Re-review found that mounted usage detection treated a local command beginning with the mount prefix as already mounted.
- Final API review found that exported reusable `CommandConfig` values were not accepted once widened.

The accepted issues were fixed by:

- matching path-scoped middleware against the selected route's canonical pattern and aliases;
- rejecting alias/canonical pattern collisions in the same router;
- normalizing whitespace before alias/canonical collision comparisons;
- validating command input feature pattern and alias compatibility before mutating the route;
- avoiding double-prefixing for mounted absolute usage overrides;
- preserving mount prefixes when router and command literals repeat;
- adding `CommandConfig` overloads and `CommandInputDefinition`/`CommandFeature` metadata support;
- reshaping `CommandConfig` overloads so reusable exported configs remain accepted after widening;
- adding focused regression tests for each accepted finding.

## Step 5: Router Mount/Prefix Model

Branch: `codex/p0-router-mount-prefix`
Parent: `codex/p0-command-metadata`
Status: implemented, subagent review pending

### Intent

Separate router identity from command prefix by adding explicit mount boundaries:

- `cli.mount("target", router)`
- `router.mount("registry", childRouter)`
- existing `use(router)` remains a compatibility/convenience API that still uses the child router `name` as the prefix

### Files Changed

- `core/framework/src/router/index.ts`
- `core/framework/src/cli/index.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/types/cli.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`
- `docs/superpowers/history/2026-05-22-core-framework-p0-history.md`

### Tests Added

- CLI mounts routers at explicit prefixes independent of router names
- router-to-router mounts use explicit prefixes independent of child router names
- help output shows explicit mount prefixes and omits router identity names as command prefixes
- path-scoped middleware matches explicit mount prefixes
- empty explicit mount prefixes are rejected
- non-literal explicit mount prefixes are rejected
- type inference carries router option types through explicit mounts

### Verification

Red checks:

- `bun test core/framework/src/cli.test.ts -t "explicit mount|explicit prefixes|mount prefixes"`
- Expected failure before implementation: `cli.mount` and `router.mount` did not exist.
- `bun run typecheck`
- Expected failure before implementation: public `Cli` and `Router` types had no `mount` API.

Green checks:

- `bun test core/framework/src/cli.test.ts -t "explicit mount|explicit prefixes|mount prefixes"`
- `bun test core/framework/src/types.test.ts -t "explicit mounts"`
- `bun run check`

The full verification passed with 124 tests.

### Implementation Notes

- Router children now store `{ state, path? }` so `use(router)` can keep the existing name-based prefix behavior while `mount(path, router)` supplies an explicit command path.
- `collectRouteEntries` accepts an optional mount path for the current router state and falls back to `state.name` only when no explicit mount path exists.
- `collectOptionDefinitions` traverses mounted child records and preserves existing option propagation behavior.
- `cli.mount(path, router)` installs an anonymous parent router with the explicit mounted child, preserving plugin installation behavior for options, middleware, and help providers.
- `router.mount(path, router)` composes mounted routers inside routers without using the child router `name` as an extra command prefix.
- Explicit mount paths participate in help, route matching, and path-scoped middleware through the same route-entry model.
- Explicit mount paths are literal-only and non-empty. Param/rest/optional pattern tokens are rejected so mount params cannot appear at runtime without type support.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- Both reviews found that explicit mount prefixes accepted pattern tokens such as `<tenant>`, creating untyped mount params and violating the literal-token requirement.
- One review found that empty mount prefixes silently flattened named child routers and discarded the router `name` prefix.

The accepted issues were fixed by:

- validating explicit mount paths at registration time;
- rejecting empty or whitespace-only mount paths;
- rejecting param/rest/optional pattern tokens in mount paths;
- adding regression tests for empty and non-literal explicit mount prefixes.

## Step 6: Route-Level Error Boundaries

Branch: `codex/p0-route-error-boundary`
Parent: `codex/p0-router-mount-prefix`
Status: implemented, subagent review pending

### Intent

Add local error handling for commands and routers:

- command-level `.catch(handler)`
- router-level `.onError(handler)`
- command boundary runs before router boundaries
- nearest router boundary runs before parent router boundaries
- global `cli.onError` remains the final fallback
- validation errors can be handled locally and retain default behavior unless overridden

### Files Changed

- `core/framework/src/router/index.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/types/route.ts`
- `core/framework/src/types/index.ts`
- `core/framework/src/index.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`
- `docs/superpowers/history/2026-05-22-core-framework-p0-history.md`

### Tests Added

- command catch handlers override action errors before global handlers
- nearest router error boundaries handle command errors before parent boundaries
- router boundaries can return `undefined` to fall back to global handlers
- command catch handlers can override validation errors
- local boundaries that return validation errors preserve exit code `2`
- local boundaries that return plain objects preserve failure status
- handled local errors do not render through action presenters
- command catch handlers do not swallow parent router/path middleware errors
- nearest router boundary handles child router middleware errors
- exported `RouteErrorHandler` values can be passed back into `.catch()` and `.onError()`
- command and router error boundaries receive typed route contexts

### Verification

Red checks:

- `bun test core/framework/src/cli.test.ts -t "command catch|router error boundaries|validation errors"`
- Expected failure before implementation: command builder had no `.catch()` and routers had no `.onError()`.
- `bun run typecheck`
- Expected failure before implementation: public `CommandBuilder` and `Router` types had no error boundary APIs.

Green checks:

- `bun test core/framework/src/cli.test.ts -t "command catch|router error boundaries|validation errors|global error handlers"`
- `bun run typecheck`
- `bun run check`

The full verification passed with 134 tests.

### Implementation Notes

- `RouteErrorContext` and `RouteErrorHandler` are public types for local boundaries.
- `CommandBuilder.catch(handler)` stores command-level handlers on the route.
- `Router.onError(handler)` stores router-level handlers on router state.
- Route entries carry a parent-to-child router boundary chain and middleware ownership metadata.
- Errors from command input/action/command middleware run command handlers first, then router handlers from nearest to farthest.
- Router middleware errors are handled by the router boundary chain that owns that middleware; command catch handlers do not handle parent router/path middleware failures.
- Router-owned middleware error handlers run nearest-router first, then parent routers.
- A boundary that returns `undefined` declines to handle and lets the next boundary run.
- If every local boundary declines, the original error is rethrown to the existing global `cli.onError` path.
- The route pipeline now awaits each middleware/action step inside ownership-aware try/catch blocks so asynchronous action and middleware errors are catchable by the right local boundary.
- Handled local errors are stored as route results with fallback error status, so validation errors keep exit code `2` and plain object returns keep failure status unless the handler returns `ctx.exit(...)`.
- Handled local errors do not use action presenters because boundary results are not typed as the action result shape.
- Error boundary context types intentionally expose broad `Record<string, unknown>` params/options plus `ctx.raw`, because option/input validation can fail before finalized values exist.
- `RouteErrorHandler` defaults match the public `.catch()`/`.onError()` APIs so reusable exported handlers are assignable.

### Review Notes

Two subagent reviews were requested after the initial implementation:

- One review found that local boundaries returning a validation error object lost the default validation exit code `2`.
- One review found that local boundary contexts were typed as finalized route params/options even though validation and input parsing can fail before finalized values exist.
- One review found that command catch handlers could swallow parent router/path middleware errors.
- One review found that handled local error results were rendered through action presenters even though boundary return values are not action-result typed.
- One review found that plain local error-handler returns became successful command results instead of preserving fallback failure status.
- Re-review found that child router middleware errors were handled by parent boundaries before nearest child boundaries.
- Re-review found that exported reusable `RouteErrorHandler` values were not assignable to `.catch()` or `.onError()`.

The accepted issues were fixed by:

- storing handled local boundary results with fallback failure status;
- preserving validation default exit code `2` unless a boundary returns `ctx.exit(...)`;
- broadening route error boundary params/options types and keeping `ctx.raw` available for raw matched data;
- replacing the flattened route middleware catch with an ownership-aware route pipeline;
- running router middleware boundary chains nearest-first;
- avoiding action presenters for handled local boundary results;
- aligning `RouteErrorHandler` defaults with the public boundary API;
- adding focused regression tests for each accepted finding.

## Step 8: CLI Examples and Metadata Sugar

Branch: `codex/p0-cli-examples`
Parent: `codex/p0-route-error-boundary`
Status: implemented, subagent review addressed

### Intent

Add runnable `apps/clip-cli` examples that exercise the P0 core framework surface end to end, and add a small public `meta()` helper so command metadata can be declared as a named sugar instead of a raw config object.

The example app now demonstrates:

- Zod-backed command input with transformed params/options.
- Command metadata aliases, usage overrides, examples, group, and help integration.
- Explicit router mounts and partial path middleware.
- Route-level error boundaries.

### Files Changed

- `apps/clip-cli/package.json`
- `apps/clip-cli/src/app.ts`
- `apps/clip-cli/src/app.test.ts`
- `bun.lock`
- `core/framework/src/router/index.ts`
- `core/framework/src/types/cli.ts`
- `core/framework/src/types/router.ts`
- `core/framework/src/meta/index.ts`
- `core/framework/src/index.ts`
- `core/framework/src/cli.test.ts`
- `core/framework/src/types.test.ts`

### Tests Added

- `runs zod-backed command input examples`
- `runs command metadata alias examples`
- `runs explicit mount and partial path middleware examples`
- `runs route-level error boundary examples`
- `runs command-level error boundary examples`
- `drops middleware-populated options that are not defined on the selected route`
- `accepts meta helper as command metadata config`
- `accepts meta helper with command input features`

### Implementation Notes

- `apps/clip-cli` depends on `@clip/input-zod` and uses the same public adapter shape intended by the P0 design.
- `publish <name>` now declares help-facing metadata through `meta({...})`, which is exported from `@clip/core`.
- `meta()` is intentionally a registration-time helper over `CommandConfig`; metadata is still stored on each router route in memory and later projected into `HelpRoute` records.
- `command(pattern, feature, meta({...}))` is now accepted, so metadata can compose with command input features in one command declaration without losing action type inference.
- The tools example now covers both router-level `.onError()` and command-level `.catch()` boundaries.
- The examples use generic resource/service names and dummy tokens only.

### Verification

Green checks:

- `bun test apps/clip-cli/src/app.test.ts`
- `bun test core/framework/src/cli.test.ts -t "meta helper"`
- `bun test core/framework/src/types.test.ts -t "input features"`
- `bun run check`

The full verification passed with 159 tests.

### Review Notes

Parallel subagent review found and drove fixes for:

- `meta()` being usable as a raw metadata config but not composable with command input features in one command declaration.
- The app error boundary example covering router-level `.onError()` but not command-level `.catch()`.
- The `meta()` helper test checking rendered help text instead of the structured route metadata contract.

The accepted issues were fixed by:

- allowing `command(pattern, feature, meta({...}))` and preserving input-derived action types;
- switching the `meta()` core test to assert structured help metadata;
- expanding `apps/clip-cli` examples and tests for command-level error boundaries.

Final verification:

- `bun run check`

The final full verification passed with 159 tests.
