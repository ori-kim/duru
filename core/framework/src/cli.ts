import { type OptionDefinition, parseOptions } from "./options.ts";
import { createOutputWriter } from "./output.ts";
import { type CliPlugin, isCliPlugin, option as optionPlugin } from "./plugin.ts";
import { createRouter } from "./router.ts";
import type { CommandBuilder } from "./router.ts";
import type {
  CliRunOptions,
  CliRunResult,
  Context,
  EmptyObject,
  MergeOptions,
  Middleware,
  OptionSpecOptions,
  Options,
  Output,
  Renderer,
} from "./types.ts";

export type CliOptions<TGlobalOptions extends Options = Options> = {
  name?: string;
};

export type Cli<TGlobalOptions extends Options = EmptyObject> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Cli<MergeOptions<TGlobalOptions, OptionSpecOptions<TSpec>>>;
  use<TAddedOptions extends Options>(
    plugin: CliPlugin<TAddedOptions>,
  ): Cli<MergeOptions<TGlobalOptions, TAddedOptions>>;
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
  const globalOptions: OptionDefinition[] = [];
  const middleware: Middleware[] = [];
  const renderers = new Map<string, Renderer>();
  const rendererSelectors: Array<(ctx: Context) => string | undefined> = [];
  const usageProviders: Array<(name: string) => string> = [];
  const services = new Map<string, unknown>();
  const defaultRouter = createRouter<TGlobalOptions>();
  let defaultRenderer = "text";

  const cli: Cli<TGlobalOptions> = {
    option(spec, description) {
      return cli.use(optionPlugin(spec, description)) as never;
    },
    use(item: CliPlugin<Options> | Middleware<TGlobalOptions>) {
      if (isCliPlugin(item)) {
        item.install(pluginApi());
        return cli as never;
      }
      middleware.push(item as Middleware);
      return cli;
    },
    renderer(renderer) {
      pluginApi().renderer(renderer);
      pluginApi().defaultRenderer(renderer.id);
      return cli;
    },
    command<TPattern extends string>(pattern: TPattern, description?: string) {
      return defaultRouter.command(pattern, description);
    },
    run(argv = [], runOptions = {}) {
      return runCli(argv, runOptions);
    },
  };

  return cli;

  function pluginApi() {
    return {
      option(definition: OptionDefinition) {
        globalOptions.push(definition);
      },
      options() {
        return [...globalOptions];
      },
      middleware(fn: Middleware) {
        middleware.push(fn);
      },
      renderer(renderer: Renderer) {
        renderers.set(renderer.id, renderer);
      },
      defaultRenderer(id: string) {
        defaultRenderer = id;
      },
      selectRenderer(selector: (ctx: Context) => string | undefined) {
        rendererSelectors.push(selector);
      },
      usage(provider: (name: string) => string) {
        usageProviders.push(provider);
      },
    };
  }

  async function runCli(argv: readonly string[], runOptions: CliRunOptions): Promise<CliRunResult> {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      return renderResult(helpResult(argv), runOptions);
    }

    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals);
    await runPipeline([...middleware, defaultRouter.middleware(() => globalOptions)], ctx, async () => undefined);
    const handled = ctx.state.get("handled") === true;
    const outputs = handled
      ? ctx.output.list()
      : [{ kind: "text" as const, text: `Unknown command: ${argv.join(" ")}` }];
    return renderResult({ ok: handled, exitCode: handled ? 0 : 1, outputs, ctx }, runOptions);
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
    const rendererId = runOptions.renderer ?? selectRenderer(ctx) ?? defaultRenderer;
    const renderer = renderers.get(rendererId);
    if (!renderer) return { ok: result.ok, exitCode: result.exitCode, outputs: result.outputs };
    const rendered = await renderer.render(result.outputs, ctx);
    return { ok: result.ok, exitCode: rendered.exitCode, outputs: result.outputs, rendered };
  }

  function helpResult(argv: readonly string[]) {
    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals);
    return {
      ok: true,
      exitCode: 0,
      outputs: [{ kind: "text" as const, text: usageText(options.name ?? "cli") }],
      ctx,
    };
  }

  function createContext(argv: readonly string[], parsedOptions: Options, positionals: readonly string[]): Context {
    const output = createOutputWriter();
    return {
      request: { argv, pattern: "", params: {}, options: parsedOptions, positionals },
      params: {},
      options: parsedOptions,
      output,
      state: new Map(),
      service<T>(key: string): T | undefined {
        return services.get(key) as T | undefined;
      },
      setService(key, value) {
        services.set(key, value);
      },
    };
  }

  function selectRenderer(ctx: Context) {
    for (const selector of rendererSelectors) {
      const id = selector(ctx);
      if (id) return id;
    }
    return undefined;
  }

  function usageText(name: string) {
    return [defaultRouter.usage(name), ...usageProviders.map((provider) => provider(name))].join("\n");
  }
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
