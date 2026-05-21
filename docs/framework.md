# Clip Framework Direction

This branch resets Clip around a CLI framework core.

## Package Roles

- `core/framework` publishes `@clip/core` and owns the framework kernel.
- `packages/*` contains framework adapters and Clip feature modules.
- `apps/*` contains concrete products built by composing the framework and packages.

## Core Responsibilities

`@clip/core` is intentionally generic. It owns:

- command pattern routing
- option parsing
- middleware and action execution
- request/context contracts
- output contracts
- renderer adapter contracts
- public API type inference

It does not own Clip product concepts such as targets, workflows, auth providers, storage, or drivers. Those should become packages that install services, middleware, commands, or renderers into a CLI app.

## Current Slice

The first runnable slice contains:

- `createCli()`
- `createRouter()`
- `cli.use()` plugins and middleware
- `.command().option().action()`
- global and router options
- middleware
- structured output collection
- text and JSON renderer adapters
- `apps/clip-cli` demo commands

## Type-Safe Public API

The public authoring API is designed around literal-preserving fluent chains:

```ts
createCli()
  .use(renderer(jsonRenderer(), textRenderer()))
  .command("build <entry> [...args]")
  .option("-w, --watch")
  .option("--timeout-ms <ms>")
  .action((entry, args, options, ctx) => {
    entry satisfies string;
    args satisfies string[];
    options.json satisfies boolean | undefined;
    options.watch satisfies boolean | undefined;
    options.timeoutMs satisfies string | undefined;
    ctx.params.entry satisfies string;
  });
```

Pattern params, option names, option value kinds, `ctx.params`, and `ctx.options` should all be inferred from the fluent declarations. Generic parameters remain available for app-level globals that are installed outside a literal-preserving chain.

`command()`, `option()`, `action()`, and renderer registration are convenience layers over the `use()` primitive:

```ts
const router = createRouter().option("--json");

router.command("inspect").action((options, ctx) => {
  options.json satisfies boolean | undefined;
  ctx.output.data({ ok: true });
});

const cli = createCli()
  .use(renderer(jsonRenderer(), textRenderer()))
  .use(router);
```

Plugins can install options, middleware, renderers, usage providers, and renderer selectors while carrying their contributed option types into downstream commands.

This keeps the framework shape testable before Clip product modules are reintroduced.
