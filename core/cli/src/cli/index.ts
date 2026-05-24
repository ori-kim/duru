import {
  commandGraphCompletionContributor,
  completeFromContributors,
  createCompletionRegistry,
} from "../completion/index.ts";
import { commandAliasesComposer } from "../compose/index.ts";
import { createContext, createEmptyContext } from "../context/index.ts";
import { helpPath, usageHelpRoutes } from "../help/index.ts";
import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptions, validateOptionDefinition } from "../options/index.ts";
import { isCliPlugin, option as optionPlugin } from "../plugin/index.ts";
import { createRouter, getRouteResult, getRouterOptionDefinitions, isRouteHandled } from "../router/index.ts";
import type {
  Cli,
  CliEventHandler,
  CliEventName,
  CliEventRecord,
  CliOptions,
  CliPlugin,
  CliPluginApi,
  CliRunOptions,
  CliRunResult,
  CommandComposer,
  CommandConfig,
  CommandFeature,
  CommandPattern,
  Context,
  EmptyObject,
  HelpDocument,
  HelpRoute,
  Middleware,
  OptionDefinition,
  OptionFallbackProvider,
  OptionSpec,
  Options,
  Params,
  Renderer,
  RouteErrorHandler,
  Router,
} from "../types/index.ts";
import { createEventContext } from "./events.ts";
import {
  type ExecutionResult,
  defaultErrorResult,
  defaultNotFoundResult,
  eventResult,
  normalizeExecutionResult,
  present,
  renderInput,
} from "./result.ts";

type CliRouteRuntime = {
  middleware: Middleware[];
  errorHandlers: RouteErrorHandler[];
  optionFallbacks: OptionFallbackProvider[];
};

const routeRuntimeByCli = new WeakMap<object, CliRouteRuntime>();

export function createCli<TGlobalOptions extends Options = EmptyObject, TValues extends object = EmptyObject>(
  options: CliOptions = {},
): Cli<TGlobalOptions, TValues> {
  const globalOptions: OptionDefinition[] = [];
  const middleware: Middleware[] = [];
  const renderers = new Map<string, Renderer>();
  const rendererSelectors: Array<(ctx: Context) => string | undefined> = [];
  const eventHandlers = new Map<string, CliEventHandler[]>();
  const appErrorHandlers: RouteErrorHandler[] = [];
  const coreCommandComposerCount = 1;
  const commandComposers: CommandComposer[] = [commandAliasesComposer];
  const optionFallbackProviders: OptionFallbackProvider[] = [];
  const completions = createCompletionRegistry();
  const helpProviders: Array<() => readonly HelpRoute[]> = [];
  const usageProviders: Array<(name: string) => string> = [];
  const services = new Map<string, unknown>();
  const defaultRouter = createRouter<TGlobalOptions, TValues>();
  const routeMiddleware: Middleware[] = [];
  let defaultRenderer: string | undefined;

  const cli = {
    ...defaultRouter,
    option<TSpec extends string>(spec: OptionSpec<TSpec>, description?: string) {
      defaultRouter.option(spec, description);
      return cli.use(optionPlugin(spec, description)) as never;
    },
    use(
      item: CliPlugin<Options, object> | Middleware<TGlobalOptions, Params, TValues> | string,
      scopedMiddleware?: Middleware<TGlobalOptions, Params, TValues>,
    ) {
      if (typeof item === "string") {
        if (scopedMiddleware) defaultRouter.use(item, scopedMiddleware as Middleware);
        return cli as never;
      }
      if (isCliPlugin(item)) {
        item.install(pluginApi());
        return cli as never;
      }
      middleware.push(item as Middleware);
      routeMiddleware.push(item as Middleware);
      return cli;
    },
    route<TAddedOptions extends Options, TAddedValues extends object>(
      path: string,
      app: Cli<TAddedOptions, TAddedValues>,
    ) {
      const router = app as unknown as Router<Options, object>;
      const runtime = routeRuntimeByCli.get(app as object);
      defaultRouter.route(path, router, runtime?.middleware, runtime?.errorHandlers, runtime?.optionFallbacks);
      globalOptions.push(...getRouterOptionDefinitions(router));
      return cli as never;
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
    catch(handler) {
      appErrorHandlers.push(handler as RouteErrorHandler);
      return cli;
    },
    notFound(handler) {
      return cli.on("notFound", handler);
    },
    async emit(name, payload) {
      const ctx = createEmptyContext([], services, eventSink);
      await ctx.emit(name, payload);
    },
    command<TPattern extends string>(
      pattern?: CommandPattern<TPattern>,
      descriptionOrFeature?: string | CommandFeature<object, object> | CommandConfig<object, object>,
      maybeDescription?: string | CommandConfig,
    ) {
      return defaultRouter.command(pattern as never, descriptionOrFeature as never, maybeDescription);
    },
    run(argv = [], runOptions = {}) {
      return runCli(argv, runOptions);
    },
  } as Cli<TGlobalOptions, TValues>;

  routeRuntimeByCli.set(cli as object, {
    middleware: routeMiddleware,
    errorHandlers: appErrorHandlers,
    optionFallbacks: optionFallbackProviders,
  });

  return cli;

  function pluginApi(): CliPluginApi {
    return {
      command: cli.command as CliPluginApi["command"],
      route: cli.route as CliPluginApi["route"],
      option(definition: OptionDefinition) {
        validateOptionDefinition(definition);
        globalOptions.push(definition);
      },
      options() {
        return [...globalOptions];
      },
      optionFallback(provider: OptionFallbackProvider) {
        optionFallbackProviders.push(provider);
      },
      optionFallbacks() {
        return optionFallbackDefinitions();
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
      compose(composer: CommandComposer) {
        addCommandComposer(composer);
      },
      composers() {
        return commandComposerDefinitions();
      },
      completion(contributor) {
        completions.add(contributor);
      },
      completions() {
        return completions.list();
      },
      complete(ctx, options) {
        return completeFromContributors(
          ctx,
          [commandGraphCompletionContributor(helpDocument), ...completions.list()],
          options,
        );
      },
      helpDocument(argv: readonly string[]) {
        return helpDocument(argv);
      },
      helpRoutes(provider: () => readonly HelpRoute[]) {
        helpProviders.push(provider);
      },
      usage(provider: (name: string) => string) {
        usageProviders.push(provider);
      },
    };
  }

  function addCommandComposer(composer: CommandComposer): void {
    if (composer === commandAliasesComposer) return;
    commandComposers.splice(commandComposers.length - coreCommandComposerCount, 0, composer);
  }

  async function runCli(argv: readonly string[], runOptions: CliRunOptions): Promise<CliRunResult> {
    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals, services, eventSink);
    let pipelineResult: unknown;

    try {
      pipelineResult = await runPipeline(
        [
          ...middleware,
          defaultRouter.middleware(() => globalOptions, commandComposerDefinitions, optionFallbackDefinitions),
        ],
        ctx,
        async () => undefined,
      );
    } catch (error) {
      const fallback = defaultErrorResult(error, ctx);
      const appCatchResult = await handleAppError(error, ctx, fallback);
      if (appCatchResult) return renderResult(appCatchResult, runOptions);
      return renderResult(eventResult(await ctx.emit("error", { error }), fallback, ctx), runOptions);
    }

    if (pipelineResult !== undefined) {
      return renderResult({ ok: true, exitCode: 0, result: pipelineResult, ctx }, runOptions);
    }

    const handled = isRouteHandled(ctx);
    const routeResult = getRouteResult(ctx);
    if (handled && routeResult) {
      return renderResult(
        {
          ok: routeResult.ok ?? true,
          exitCode: routeResult.exitCode ?? 0,
          result: routeResult.result,
          presenters: routeResult.presenters,
          ctx,
        },
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

    if (!rendererId) return base;

    const renderer = renderers.get(rendererId);
    if (!renderer) return base;

    const rendered = await renderer.render(renderInput(rendererId, execution.result, value, events), ctx);
    return { ...base, rendered: { ...rendered, exitCode: execution.exitCode } };
  }

  function helpDocument(argv: readonly string[]): HelpDocument {
    const routes = allHelpRoutes();
    const path = helpPath(argv, routes);
    return {
      name: options.name ?? "cli",
      path,
      globalOptions,
      routes,
    };
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

  async function handleAppError(
    error: unknown,
    ctx: Context,
    fallback: ExecutionResult,
  ): Promise<ExecutionResult | undefined> {
    for (const handler of appErrorHandlers) {
      const result = await handler({ ...ctx, error });
      if (result !== undefined) return eventResult(result, fallback, ctx);
    }
    return undefined;
  }

  function selectRenderer(ctx: Context) {
    for (const selector of rendererSelectors) {
      const id = selector(ctx);
      if (id) return id;
    }
    return undefined;
  }

  function allHelpRoutes(): readonly HelpRoute[] {
    const routes = [
      ...defaultRouter.helpRoutes(commandComposerDefinitions),
      ...helpProviders.flatMap((provider) => [...provider()]),
    ];
    return routes.length > 0
      ? routes
      : usageProviders.flatMap((provider) => usageHelpRoutes(provider(options.name ?? "cli")));
  }

  function commandComposerDefinitions(): readonly CommandComposer[] {
    return [...commandComposers];
  }

  function optionFallbackDefinitions(): readonly OptionFallbackProvider[] {
    return [...optionFallbackProviders];
  }
}
