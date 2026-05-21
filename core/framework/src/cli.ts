import { type OptionDefinition, parseOptionSpec, parseOptions } from "./options.ts";
import { createOutputWriter, normalizeActionResult } from "./output.ts";
import { type CompiledPattern, compilePattern } from "./pattern.ts";
import type {
  ActionResult,
  CliRunOptions,
  CliRunResult,
  Context,
  EmptyObject,
  MergeOptions,
  Middleware,
  OptionSpecOptions,
  Options,
  Output,
  PatternActionArgs,
  PatternParams,
  Renderer,
} from "./types.ts";

type Action = (...args: unknown[]) => Promise<ActionResult> | ActionResult;

type Route = {
  pattern: CompiledPattern;
  description?: string;
  options: OptionDefinition[];
  middleware: Middleware[];
  action?: Action;
};

export type CliOptions<TGlobalOptions extends Options = Options> = {
  name?: string;
  defaultRenderer?: string;
  selectRenderer?(ctx: Context<TGlobalOptions>): string;
};

export type CommandBuilder<
  TPattern extends string = string,
  TGlobalOptions extends Options = Options,
  TLocalOptions extends Options = EmptyObject,
> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): CommandBuilder<TPattern, TGlobalOptions, MergeOptions<TLocalOptions, OptionSpecOptions<TSpec>>>;
  use(
    middleware: Middleware<MergeOptions<TGlobalOptions, TLocalOptions>, PatternParams<TPattern>>,
  ): CommandBuilder<TPattern, TGlobalOptions, TLocalOptions>;
  action(
    handler: (
      ...args: PatternActionArgs<TPattern, MergeOptions<TGlobalOptions, TLocalOptions>>
    ) => Promise<ActionResult> | ActionResult,
  ): CommandBuilder<TPattern, TGlobalOptions, TLocalOptions>;
};

export type Cli<TGlobalOptions extends Options = EmptyObject> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Cli<MergeOptions<TGlobalOptions, OptionSpecOptions<TSpec>>>;
  use(middleware: Middleware<TGlobalOptions>): Cli<TGlobalOptions>;
  renderer(renderer: Renderer): Cli<TGlobalOptions>;
  command<TPattern extends string>(
    pattern: TPattern,
    description?: string,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject>;
  run(argv?: readonly string[], options?: CliRunOptions): Promise<CliRunResult>;
};

export function createCli<TGlobalOptions extends Options = EmptyObject>(
  options: CliOptions<TGlobalOptions> = {},
): Cli<TGlobalOptions> {
  const routes: Route[] = [];
  const globalOptions: OptionDefinition[] = [];
  const middleware: Middleware[] = [];
  const renderers = new Map<string, Renderer>();
  const services = new Map<string, unknown>();

  const cli: Cli<TGlobalOptions> = {
    option(spec, description) {
      globalOptions.push(parseOptionSpec(spec, description));
      return cli as never;
    },
    use(fn) {
      middleware.push(fn as Middleware);
      return cli;
    },
    renderer(renderer) {
      renderers.set(renderer.id, renderer);
      return cli;
    },
    command<TPattern extends string>(pattern: TPattern, description?: string) {
      const route: Route = { pattern: compilePattern(pattern), description, options: [], middleware: [] };
      routes.push(route);
      return createCommandBuilder<TPattern>(route);
    },
    run(argv = [], runOptions = {}) {
      return runCli(argv, runOptions);
    },
  };

  return cli;

  function createCommandBuilder<TPattern extends string>(
    route: Route,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject> {
    const builder: CommandBuilder<TPattern, TGlobalOptions, Options> = {
      option(spec, description) {
        route.options.push(parseOptionSpec(spec, description));
        return builder as never;
      },
      use(fn) {
        route.middleware.push(fn as Middleware);
        return builder as never;
      },
      action(handler) {
        route.action = handler as unknown as Action;
        return builder as never;
      },
    };
    return builder as never;
  }

  async function runCli(argv: readonly string[], runOptions: CliRunOptions): Promise<CliRunResult> {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      return renderResult(helpResult(), runOptions);
    }

    for (const route of routes) {
      const parsed = parseOptions(argv, [...globalOptions, ...route.options]);
      const match = route.pattern.match(parsed.positionals);
      if (!match) continue;
      const output = createOutputWriter();
      const ctx: Context = {
        request: {
          argv,
          pattern: route.pattern.pattern,
          params: match.params,
          options: parsed.options,
          positionals: match.positionals,
        },
        params: match.params,
        options: parsed.options,
        output,
        state: new Map(),
        service<T>(key: string): T | undefined {
          return services.get(key) as T | undefined;
        },
        setService(key, value) {
          services.set(key, value);
        },
      };
      const actionResult = await runPipeline([...middleware, ...route.middleware], ctx, () => runAction(route, ctx));
      const outputs = [...output.list(), ...normalizeActionResult(actionResult as ActionResult)];
      return renderResult({ ok: true, exitCode: 0, outputs, ctx }, runOptions);
    }

    return renderResult(
      { ok: false, exitCode: 1, outputs: [{ kind: "text", text: `Unknown command: ${argv.join(" ")}` }] },
      runOptions,
    );
  }

  function runAction(route: Route, ctx: Context): Promise<ActionResult> | ActionResult {
    const args = route.pattern.paramNames.map((name) => ctx.params[name]);
    return route.action?.(...args, ctx.options, ctx);
  }

  async function renderResult(
    result: {
      ok: boolean;
      exitCode: number;
      outputs: readonly Output[];
      ctx?: Context;
    },
    runOptions: CliRunOptions,
  ): Promise<CliRunResult> {
    const shouldRender = runOptions.render ?? true;
    if (!shouldRender) return { ok: result.ok, exitCode: result.exitCode, outputs: result.outputs };
    const ctx = result.ctx ?? emptyContext(argvFromOutputs(result.outputs));
    const rendererId =
      runOptions.renderer ??
      options.selectRenderer?.(ctx as Context<TGlobalOptions>) ??
      options.defaultRenderer ??
      "text";
    const renderer = renderers.get(rendererId);
    if (!renderer) return { ok: result.ok, exitCode: result.exitCode, outputs: result.outputs };
    const rendered = await renderer.render(result.outputs, ctx);
    return { ok: result.ok, exitCode: rendered.exitCode, outputs: result.outputs, rendered };
  }

  function helpResult() {
    return {
      ok: true,
      exitCode: 0,
      outputs: [{ kind: "text" as const, text: usageText(options.name ?? "cli", routes) }],
    };
  }
}

async function runPipeline(middleware: readonly Middleware[], ctx: Context, action: () => Promise<unknown> | unknown) {
  let index = -1;
  async function dispatch(nextIndex: number): Promise<unknown> {
    if (nextIndex <= index) throw new Error("next() called multiple times");
    index = nextIndex;
    const fn = middleware[nextIndex];
    return fn ? fn(ctx, () => dispatch(nextIndex + 1)) : action();
  }
  return dispatch(0);
}

function usageText(name: string, routes: readonly Route[]): string {
  const lines = [`Usage: ${name} <command>`, "", "Commands:"];
  for (const route of routes) {
    lines.push(`  ${route.pattern.pattern}${route.description ? `  ${route.description}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function argvFromOutputs(_outputs: readonly unknown[]): readonly string[] {
  return [];
}

function emptyContext(argv: readonly string[]): Context {
  const output = createOutputWriter();
  return {
    request: { argv, pattern: "", params: {}, options: {}, positionals: [] },
    params: {},
    options: {},
    output,
    state: new Map(),
    service() {
      return undefined;
    },
    setService() {},
  };
}
