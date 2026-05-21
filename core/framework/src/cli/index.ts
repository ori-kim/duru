import { createContext, createEmptyContext } from "../context/index.ts";
import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptions } from "../options/index.ts";
import { isCliPlugin, option as optionPlugin } from "../plugin/index.ts";
import { type RouteResultState, createRouter, routeResultStateKey } from "../router/index.ts";
import type {
  Cli,
  CliOptions,
  CliPlugin,
  CliRunOptions,
  CliRunResult,
  Context,
  EmptyObject,
  Middleware,
  OptionDefinition,
  Options,
  RenderInput,
  Renderer,
  RoutePresenter,
} from "../types/index.ts";

type ExecutionResult = {
  ok: boolean;
  exitCode: number;
  result: unknown;
  presenters?: ReadonlyMap<string, RoutePresenter<unknown>>;
  ctx?: Context;
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
    const ctx = createContext(argv, parsed.options, parsed.positionals, services);
    await runPipeline([...middleware, defaultRouter.middleware(() => globalOptions)], ctx, async () => undefined);
    const handled = ctx.state.get("handled") === true;
    const routeResult = ctx.state.get(routeResultStateKey) as RouteResultState | undefined;
    const message = `Unknown command: ${argv.join(" ")}`;
    return renderResult(
      handled && routeResult
        ? { ok: true, exitCode: 0, result: routeResult.result, presenters: routeResult.presenters, ctx }
        : {
            ok: false,
            exitCode: 1,
            result: { message },
            presenters: errorPresenters(message),
            ctx,
          },
      runOptions,
    );
  }

  async function renderResult(result: ExecutionResult, runOptions: CliRunOptions): Promise<CliRunResult> {
    const ctx = result.ctx ?? createEmptyContext([]);
    const rendererId = runOptions.renderer ?? selectRenderer(ctx) ?? defaultRenderer;
    const value = await present(rendererId, result.result, result.presenters, ctx);
    const events = ctx.events();
    const shouldRender = runOptions.render ?? true;
    if (!shouldRender) return { ok: result.ok, exitCode: result.exitCode, result: result.result, value, events };
    const renderer = renderers.get(rendererId);
    if (!renderer) return { ok: result.ok, exitCode: result.exitCode, result: result.result, value, events };
    const rendered = await renderer.render(renderInput(rendererId, result.result, value, events), ctx);
    return { ok: result.ok, exitCode: rendered.exitCode, result: result.result, value, events, rendered };
  }

  function helpResult(argv: readonly string[]) {
    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals, services);
    return {
      ok: true,
      exitCode: 0,
      result: usageText(options.name ?? "cli"),
      ctx,
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
    const sections = [defaultRouter.usage(name), ...usageProviders.map((provider) => provider(name))];
    const commands = sections.flatMap(commandLines);
    const text = [`Usage: ${name} <command>`, "", "Commands:", ...commands].join("\n").trimEnd();
    return `${text}\n`;
  }
}

function commandLines(usage: string): string[] {
  const lines = usage.split("\n");
  const commandsIndex = lines.findIndex((line) => line.trim() === "Commands:");
  const linesAfterHeader = commandsIndex === -1 ? lines : lines.slice(commandsIndex + 1);
  return linesAfterHeader.filter((line) => line.trim().length > 0);
}

async function present(
  format: string,
  result: unknown,
  presenters: ReadonlyMap<string, RoutePresenter<unknown>> | undefined,
  ctx: Context,
): Promise<unknown> {
  const presenter = presenters?.get(format);
  return presenter ? presenter(result, ctx) : result;
}

function renderInput(format: string, result: unknown, value: unknown, events: readonly unknown[]): RenderInput {
  return { result, value, events, format };
}

function errorPresenters(message: string): ReadonlyMap<string, RoutePresenter<unknown>> {
  const presenters = new Map<string, RoutePresenter<unknown>>();
  presenters.set("text", () => message);
  presenters.set("json", () => ({ error: { message } }));
  return presenters;
}
