import { createContext, createEmptyContext } from "../context/index.ts";
import { formatHelp } from "../help/index.ts";
import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptions } from "../options/index.ts";
import { isCliPlugin, option as optionPlugin } from "../plugin/index.ts";
import { type RouteResultState, createRouter, routeResultStateKey } from "../router/index.ts";
import type {
  Cli,
  CliEventHandler,
  CliEventName,
  CliEventRecord,
  CliOptions,
  CliPlugin,
  CliRunOptions,
  CliRunResult,
  Context,
  EmptyObject,
  HelpDocument,
  HelpRoute,
  Middleware,
  OptionDefinition,
  Options,
  Params,
  Renderer,
} from "../types/index.ts";
import { createEventContext } from "./events.ts";
import { helpPath, isHelpRequest, usageHelpRoutes } from "./help.ts";
import {
  type ExecutionResult,
  defaultErrorResult,
  defaultNotFoundResult,
  eventResult,
  helpPresenters,
  normalizeExecutionResult,
  present,
  renderInput,
} from "./result.ts";

export function createCli<TGlobalOptions extends Options = EmptyObject, TValues extends object = EmptyObject>(
  options: CliOptions<TGlobalOptions> = {},
): Cli<TGlobalOptions, TValues> {
  const globalOptions: OptionDefinition[] = [];
  const middleware: Middleware[] = [];
  const renderers = new Map<string, Renderer>();
  const rendererSelectors: Array<(ctx: Context) => string | undefined> = [];
  const eventHandlers = new Map<string, CliEventHandler[]>();
  const helpProviders: Array<() => readonly HelpRoute[]> = [];
  const usageProviders: Array<(name: string) => string> = [];
  const services = new Map<string, unknown>();
  const defaultRouter = createRouter<TGlobalOptions, TValues>();
  let defaultRenderer = "text";

  const cli: Cli<TGlobalOptions, TValues> = {
    option(spec, description) {
      return cli.use(optionPlugin(spec, description)) as never;
    },
    use(item: CliPlugin<Options, object> | Middleware<TGlobalOptions, Params, TValues>) {
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
    on(name, handler) {
      addEventHandler(name, handler as CliEventHandler);
      return cli;
    },
    onError(handler) {
      return cli.on("error", handler);
    },
    notFound(handler) {
      return cli.on("notFound", handler);
    },
    async emit(name, payload) {
      const ctx = createEmptyContext([], services, eventSink);
      await ctx.emit(name, payload);
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
      on(name: string, handler: CliEventHandler) {
        addEventHandler(name, handler);
      },
      helpRoutes(provider: () => readonly HelpRoute[]) {
        helpProviders.push(provider);
      },
      usage(provider: (name: string) => string) {
        usageProviders.push(provider);
      },
    };
  }

  async function runCli(argv: readonly string[], runOptions: CliRunOptions): Promise<CliRunResult> {
    if (argv.length === 0 || isHelpRequest(argv)) {
      return renderResult(await helpResult(argv), runOptions);
    }

    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals, services, eventSink);

    try {
      await runPipeline([...middleware, defaultRouter.middleware(() => globalOptions)], ctx, async () => undefined);
    } catch (error) {
      const fallback = defaultErrorResult(error, ctx);
      return renderResult(eventResult(await ctx.emit("error", { error }), fallback, ctx), runOptions);
    }

    const handled = ctx.state.get("handled") === true;
    const routeResult = ctx.state.get(routeResultStateKey) as RouteResultState | undefined;
    if (handled && routeResult) {
      return renderResult(
        { ok: true, exitCode: 0, result: routeResult.result, presenters: routeResult.presenters, ctx },
        runOptions,
      );
    }

    const fallback = defaultNotFoundResult(argv, ctx);
    return renderResult(eventResult(await ctx.emit("notFound", { argv }), fallback, ctx), runOptions);
  }

  async function renderResult(result: ExecutionResult, runOptions: CliRunOptions): Promise<CliRunResult> {
    const execution = normalizeExecutionResult(result);
    const ctx = execution.ctx ?? createEmptyContext([], services, eventSink);
    const rendererId = runOptions.renderer ?? selectRenderer(ctx) ?? defaultRenderer;
    const value = await present(rendererId, execution.result, execution.presenters, ctx);
    const events = ctx.events();
    const base = { ok: execution.ok, exitCode: execution.exitCode, result: execution.result, value, events };
    if (runOptions.render === false) return base;

    const renderer = renderers.get(rendererId);
    if (!renderer) return base;

    const rendered = await renderer.render(renderInput(rendererId, execution.result, value, events), ctx);
    return { ...base, rendered: { ...rendered, exitCode: execution.exitCode } };
  }

  async function helpResult(argv: readonly string[]): Promise<ExecutionResult> {
    const parsed = parseOptions(argv, globalOptions);
    const routes = allHelpRoutes();
    const path = helpPath(argv, routes);
    const ctx = createContext(argv, parsed.options, path, services, eventSink);
    const document: HelpDocument = {
      name: options.name ?? "cli",
      path,
      globalOptions,
      routes,
    };
    const text = formatHelp(document);
    const fallback = {
      ok: true,
      exitCode: 0,
      result: text,
      presenters: helpPresenters(document, text),
      ctx,
    };
    return eventResult(await ctx.emit("help", { document }), fallback, ctx);
  }

  function eventSink(ctx: Context, event: CliEventRecord) {
    return dispatchEvent(ctx, event);
  }

  async function dispatchEvent(ctx: Context, event: CliEventRecord): Promise<unknown> {
    const handlers = eventHandlers.get(String(event.name)) ?? [];
    let result: unknown;
    for (const handler of handlers) {
      const value = await handler(createEventContext(ctx, event) as never);
      if (value !== undefined && result === undefined) result = value;
    }
    return result;
  }

  function addEventHandler<TName extends CliEventName>(name: TName, handler: CliEventHandler<TName>) {
    const key = String(name);
    eventHandlers.set(key, [...(eventHandlers.get(key) ?? []), handler as CliEventHandler]);
  }

  function selectRenderer(ctx: Context) {
    for (const selector of rendererSelectors) {
      const id = selector(ctx);
      if (id) return id;
    }
    return undefined;
  }

  function allHelpRoutes(): readonly HelpRoute[] {
    const routes = [...defaultRouter.helpRoutes(), ...helpProviders.flatMap((provider) => [...provider()])];
    return routes.length > 0
      ? routes
      : usageProviders.flatMap((provider) => usageHelpRoutes(provider(options.name ?? "cli")));
  }
}
