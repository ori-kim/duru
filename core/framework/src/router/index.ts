import { isCommandFeature } from "../input/index.ts";
import { parseOptionSpec, parseOptions, validateOptionDefinition } from "../options/index.ts";
import { compilePattern } from "../pattern/index.ts";
import { createPlugin } from "../plugin/index.ts";
import { isExitResult, isValidationError } from "../result/index.ts";
import type {
  ActionResult,
  Awaitable,
  CommandBuilder,
  CommandComposer,
  CommandConfig,
  CommandDraft,
  CommandExample,
  CommandFeature,
  CommandInputRaw,
  CommandMeta,
  CommandMetadata,
  CompiledPattern,
  Context,
  EmptyObject,
  HelpRoute,
  Middleware,
  OptionDefinition,
  OptionSpec,
  Options,
  ParamDefinition,
  Params,
  RouteErrorHandler,
  RoutePresenter,
  Router,
  RouterOptions,
} from "../types/index.ts";

type Action = (ctx: Context) => Awaitable<ActionResult>;
type ErrorBoundary = RouteErrorHandler;
type RouteRenderer = RoutePresenter<ActionResult>;
const routerTag = Symbol("clip.router");
const handledContexts = new WeakSet<Context>();
const routeResults = new WeakMap<Context, RouteResultState>();
const scopedRoutePatterns = new WeakMap<Context, readonly string[]>();

export type RouteResultState = {
  result: ActionResult;
  presenters?: ReadonlyMap<string, RouteRenderer>;
  ok?: boolean;
  exitCode?: number;
};

export function isRouteHandled(ctx: Context): boolean {
  return handledContexts.has(ctx);
}

export function getRouteResult(ctx: Context): RouteResultState | undefined {
  return routeResults.get(ctx);
}

type Route = {
  pattern: CompiledPattern;
  description?: string;
  metadata: MutableCommandMetadata;
  aliases: string[];
  options: OptionDefinition[];
  inputs: CommandInputFeature[];
  middleware: Middleware[];
  errorHandlers: ErrorBoundary[];
  action?: Action;
  presenters: Map<string, RouteRenderer>;
  appliedComposers: Set<CommandComposer>;
};

type MutableCommandMetadata = Omit<CommandMeta, "aliases" | "examples"> & {
  aliases: string[];
  examples: CommandExample[];
};

type RouterState = {
  name?: string;
  routes: Route[];
  options: OptionDefinition[];
  middleware: MiddlewareEntry[];
  errorHandlers: ErrorBoundary[];
  children: RouterChild[];
};

type RouterChild = {
  state: RouterState;
  path?: readonly string[];
  middleware?: readonly Middleware[];
  errorHandlers?: readonly ErrorBoundary[];
};

type RouteEntry = {
  route: Route;
  pattern: CompiledPattern;
  canonicalPattern: CompiledPattern;
  aliases: readonly CompiledPattern[];
  options: readonly OptionDefinition[];
  middleware: readonly MiddlewareStep[];
  errorHandlers: readonly ErrorBoundary[];
};

type RouteScope = {
  path: readonly string[];
  options: readonly OptionDefinition[];
  middleware: readonly MiddlewareStep[];
  errorHandlers: readonly ErrorBoundary[];
};

type MiddlewareStep = {
  middleware: Middleware;
  errorHandlers: readonly ErrorBoundary[];
};

type RouterRuntime = Router<Options, object> & { readonly [routerTag]: RouterState };
type CommandInputFeature = CommandFeature<object, object>;
type TransformedParams = Record<string, unknown>;
type TransformedOptions = Record<string, unknown>;
type MiddlewareEntry =
  | {
      kind: "middleware";
      middleware: Middleware;
    }
  | {
      kind: "scopedMiddleware";
      path: readonly string[];
      middleware: Middleware;
    };

export function createRouter<TRouterOptions extends Options = EmptyObject, TValues extends object = EmptyObject>(
  config: RouterOptions = {},
): Router<TRouterOptions, TValues> {
  const state: RouterState = {
    ...cleanRouterConfig(config),
    routes: [],
    options: [],
    middleware: [],
    errorHandlers: [],
    children: [],
  };

  const router = {
    option<TSpec extends string>(spec: OptionSpec<TSpec>, description?: string) {
      state.options.push(parseOptionSpec(spec, description));
      return router as never;
    },
    use(item: Middleware | Router<Options, object> | string, scopedMiddleware?: Middleware) {
      if (typeof item === "string") {
        if (scopedMiddleware) {
          validateMiddlewarePath(item);
          state.middleware.push({ kind: "scopedMiddleware", path: pathTokens(item), middleware: scopedMiddleware });
        }
        return router as never;
      }
      if (isRouter(item)) {
        state.children.push({ state: item[routerTag] });
        return router as never;
      }
      state.middleware.push({ kind: "middleware", middleware: item as Middleware });
      return router as never;
    },
    route(
      path: string,
      child: Router<Options, object>,
      middleware?: readonly Middleware[],
      errorHandlers?: readonly ErrorBoundary[],
    ) {
      if (!isRouter(child)) throw new Error("Expected router");
      state.children.push({
        state: child[routerTag],
        path: mountPathTokens(path),
        ...(middleware ? { middleware } : {}),
        ...(errorHandlers ? { errorHandlers } : {}),
      });
      return router as never;
    },
    onError(handler: ErrorBoundary) {
      state.errorHandlers.push(handler);
      return router as never;
    },
    command<TPattern extends string>(
      pattern: TPattern,
      descriptionOrFeature?: string | CommandInputFeature | CommandConfig<object, object>,
      maybeDescription?: string | CommandMetadata,
    ) {
      validateCommandPattern(pattern);
      const config = normalizeCommandConfig(descriptionOrFeature, maybeDescription);
      const route: Route = {
        pattern: compilePattern(pattern),
        description: config.description,
        metadata: emptyCommandMetadata(),
        aliases: [],
        options: [],
        inputs: [],
        middleware: [],
        errorHandlers: [],
        presenters: new Map(),
        appliedComposers: new Set(),
      };
      if (config.feature) applyCommandFeature(state, route, config.feature);
      if (config.metadata) mergeCommandMetadata(state, route, config.metadata);
      assertCommandPatternsAvailable(state, route, route.pattern.pattern, route.metadata.aliases);
      state.routes.push(route);
      return createCommandBuilder<TPattern>(route);
    },
    middleware(
      getGlobalOptions: () => readonly OptionDefinition[],
      getCommandComposers?: () => readonly CommandComposer[],
    ) {
      return createRouterMiddleware(state, getGlobalOptions, getCommandComposers);
    },
    usage(name: string, getCommandComposers?: () => readonly CommandComposer[]) {
      return usageText(name, state, getCommandComposers);
    },
    helpRoutes(getCommandComposers?: () => readonly CommandComposer[]) {
      return helpRoutes(state, getCommandComposers);
    },
    ...createPlugin<TRouterOptions, TValues>((api) => {
      for (const item of collectOptionDefinitions(state)) api.option(item);
      api.middleware(createRouterMiddleware(state, api.options, api.composers));
      api.helpRoutes(() => helpRoutes(state, api.composers));
      api.usage((name) => usageText(name, state, api.composers));
    }),
    [routerTag]: state,
  };

  return router as unknown as Router<TRouterOptions, TValues>;

  function createCommandBuilder<TPattern extends string>(
    route: Route,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined, TValues> {
    const builder = {
      meta(metadata: CommandMetadata) {
        mergeCommandMetadata(state, route, metadata);
        return builder as never;
      },
      alias(pattern: string) {
        addMetadataAliases(state, route, [pattern]);
        return builder as never;
      },
      aliases(...patterns: string[]) {
        addMetadataAliases(state, route, patterns);
        return builder as never;
      },
      example(example: CommandExample) {
        route.metadata.examples.push(example);
        return builder as never;
      },
      examples(...examples: CommandExample[]) {
        route.metadata.examples.push(...examples);
        return builder as never;
      },
      usage(usage: string) {
        const value = usage.trim();
        if (value) route.metadata.usage = value;
        return builder as never;
      },
      hidden(hidden = true) {
        route.metadata.hidden = hidden;
        return builder as never;
      },
      deprecated(reason: boolean | string = true) {
        route.metadata.deprecated = reason;
        return builder as never;
      },
      group(group: string) {
        const value = group.trim();
        if (value) route.metadata.group = value;
        return builder as never;
      },
      option<TSpec extends string>(spec: OptionSpec<TSpec>, description?: string) {
        addRouteOption(route, parseOptionSpec(spec, description));
        return builder as never;
      },
      input(feature: CommandInputFeature) {
        applyCommandFeature(state, route, feature);
        return builder as never;
      },
      catch(handler: ErrorBoundary) {
        route.errorHandlers.push(handler);
        return builder as never;
      },
      use(fn: Middleware) {
        route.middleware.push(fn as Middleware);
        return builder as never;
      },
      action(handler: Action) {
        route.action = handler as unknown as Action;
        return builder as never;
      },
      text(handler: RouteRenderer) {
        route.presenters.set("text", handler as unknown as RouteRenderer);
        return builder as never;
      },
      json(handler: RouteRenderer) {
        route.presenters.set("json", handler as unknown as RouteRenderer);
        return builder as never;
      },
      render(formatOrHandler: string | RouteRenderer, maybeHandler?: RouteRenderer) {
        const format = typeof formatOrHandler === "string" ? formatOrHandler : "text";
        const handler = typeof formatOrHandler === "string" ? maybeHandler : formatOrHandler;
        if (handler) route.presenters.set(format, handler as unknown as RouteRenderer);
        return builder as never;
      },
    };
    return builder as unknown as CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined, TValues>;
  }
}

export function getRouterOptionDefinitions(router: Router<Options, object>): OptionDefinition[] {
  if (!isRouter(router)) throw new Error("Expected router");
  return collectOptionDefinitions(router[routerTag]);
}

function createRouterMiddleware(
  state: RouterState,
  getGlobalOptions: () => readonly OptionDefinition[],
  getCommandComposers?: () => readonly CommandComposer[],
): Middleware {
  return async (ctx, next) => {
    for (const entry of collectRouteEntries(state, emptyScope(), true, getCommandComposers)) {
      const parsed = parseOptions(ctx.request.argv, [...getGlobalOptions(), ...entry.options]);
      const match = entry.pattern.match(parsed.positionals);
      if (!match) continue;
      const raw = {
        argv: ctx.request.argv,
        pattern: entry.pattern.pattern,
        params: cloneRawRecord(match.params),
        options: cloneRawRecord(parsed.options),
        positionals: parsed.positionals,
      } satisfies CommandInputRaw;
      scopedRoutePatterns.set(ctx, [entry.canonicalPattern.pattern, ...entry.aliases.map((alias) => alias.pattern)]);
      ctx.raw = raw;
      ctx.request = requestFromRaw(raw);
      ctx.params = { ...raw.params } as Params;
      ctx.options = { ...raw.options } as Options;
      ctx.meta = cloneCommandMeta(entry.route.metadata);
      try {
        const transformed = await parseCommandInputs(entry.route, raw);
        ctx.request = { ...raw, params: transformed.params, options: transformed.options } as Context["request"];
        ctx.params = transformed.params as Params;
        ctx.options = transformed.options as Options;
      } catch (error) {
        const handled = await handleRouteError(ctx, entry, error, routeErrorHandlers(entry));
        if (handled) return undefined;
        throw error;
      }
      handledContexts.add(ctx);
      return await runRoutePipeline(entry, ctx);
    }
    return next();
  };
}

async function runRoutePipeline(entry: RouteEntry, ctx: Context): Promise<unknown> {
  let index = -1;

  async function dispatch(nextIndex: number): Promise<unknown> {
    if (nextIndex <= index) throw new Error("next() called multiple times");
    index = nextIndex;
    const step = entry.middleware[nextIndex];
    if (!step) return runRouteAction(entry, ctx);

    let nextError: unknown;
    try {
      return await step.middleware(ctx, async () => {
        try {
          return await dispatch(nextIndex + 1);
        } catch (error) {
          nextError = error;
          throw error;
        }
      });
    } catch (error) {
      if (error === nextError) throw error;
      const handled = await handleRouteError(ctx, entry, error, step.errorHandlers);
      if (handled) return undefined;
      throw error;
    }
  }

  try {
    return await dispatch(0);
  } catch (error) {
    const handled = await handleRouteError(ctx, entry, error, appErrorHandlers(entry));
    if (handled) return undefined;
    throw error;
  }
}

async function runRouteAction(entry: RouteEntry, ctx: Context): Promise<unknown> {
  try {
    const result = await entry.route.action?.(ctx);
    setActionRouteResult(ctx, entry.route, result);
  } catch (error) {
    const handled = await handleRouteError(ctx, entry, error, entry.route.errorHandlers);
    if (handled) return undefined;
    throw error;
  }
}

function setActionRouteResult(ctx: Context, route: Route, result: ActionResult): void {
  routeResults.set(ctx, {
    result,
    presenters: route.presenters,
  } satisfies RouteResultState);
}

function setErrorRouteResult(ctx: Context, result: ActionResult, error: unknown): void {
  routeResults.set(ctx, {
    result,
    ...fallbackErrorState(error),
  } satisfies RouteResultState);
}

async function handleRouteError(
  ctx: Context,
  entry: RouteEntry,
  error: unknown,
  handlers: readonly ErrorBoundary[],
): Promise<boolean> {
  for (const handler of handlers) {
    const result = await handler({ ...ctx, error });
    if (result === undefined) continue;
    handledContexts.add(ctx);
    setErrorRouteResult(ctx, result, error);
    return true;
  }
  return false;
}

function routeErrorHandlers(entry: Pick<RouteEntry, "route" | "errorHandlers">): readonly ErrorBoundary[] {
  return [...entry.route.errorHandlers, ...appErrorHandlers(entry)];
}

function appErrorHandlers(entry: Pick<RouteEntry, "errorHandlers">): readonly ErrorBoundary[] {
  return [...entry.errorHandlers].reverse();
}

function fallbackErrorState(error: unknown): { ok: boolean; exitCode: number } {
  if (isExitResult(error)) return { ok: error.ok, exitCode: error.exitCode };
  return { ok: false, exitCode: isValidationError(error) ? 2 : 1 };
}

async function parseCommandInputs(
  route: Route,
  raw: CommandInputRaw,
): Promise<{ params: TransformedParams; options: TransformedOptions }> {
  let params: TransformedParams = { ...raw.params };
  let options: TransformedOptions = { ...raw.options };

  for (const feature of route.inputs) {
    const parsed = await feature.definition.parse(cloneCommandInputRaw(raw));
    if (parsed.params) params = { ...params, ...parsed.params };
    if (parsed.options) options = { ...options, ...parsed.options };
  }

  return { params, options };
}

function requestFromRaw(raw: CommandInputRaw): Context["request"] {
  return { ...raw, params: { ...raw.params }, options: { ...raw.options } } as Context["request"];
}

function cloneCommandInputRaw(raw: CommandInputRaw): CommandInputRaw {
  return {
    argv: [...raw.argv],
    pattern: raw.pattern,
    params: cloneRawRecord(raw.params),
    options: cloneRawRecord(raw.options),
    positionals: [...raw.positionals],
  };
}

function cloneRawRecord<TValue>(record: Readonly<Record<string, TValue | readonly string[] | undefined>>) {
  const next: Record<string, TValue | readonly string[] | undefined> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = Array.isArray(value) ? [...value] : value;
  }
  return next;
}

function cloneCommandMeta(metadata: CommandMeta): CommandMetadata {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    next[key] = Array.isArray(value) ? [...value] : value;
  }
  return next as CommandMetadata;
}

function applyCommandComposers(state: RouterState, route: Route, composers: readonly CommandComposer[]): void {
  const pending = composers.filter((composer) => !route.appliedComposers.has(composer));
  if (pending.length === 0) return;

  const command = commandDraft(state, route);
  let index = -1;

  function dispatch(nextIndex: number): void {
    if (nextIndex <= index) throw new Error("next() called multiple times");
    index = nextIndex;
    const composer = pending[nextIndex];
    if (!composer) return;

    let continued = false;
    composer(command, () => {
      continued = true;
      dispatch(nextIndex + 1);
    });
    route.appliedComposers.add(composer);
    if (!continued) {
      for (const skipped of pending.slice(nextIndex + 1)) route.appliedComposers.add(skipped);
    }
  }

  dispatch(0);
}

function commandDraft(state: RouterState, route: Route): CommandDraft {
  return {
    get pattern() {
      return route.pattern.pattern;
    },
    get meta() {
      return cloneCommandMeta(route.metadata);
    },
    get options() {
      return [...route.options];
    },
    alias(pattern: string) {
      addAliases(state, route, [pattern]);
    },
    use(middleware: Middleware) {
      route.middleware.push(middleware);
    },
    mergeMeta(metadata: CommandMeta) {
      mergeCommandMetadata(state, route, metadata);
    },
  };
}

type NormalizedCommandConfig = {
  description?: string;
  feature?: CommandInputFeature;
  metadata?: CommandMetadata;
};

function normalizeCommandConfig(
  value: string | CommandInputFeature | CommandConfig<object, object> | undefined,
  description?: string | CommandMetadata,
): NormalizedCommandConfig {
  if (typeof value === "string") return { description: value };
  if (isCommandFeature(value)) {
    const metadata = typeof description === "object" && description !== null ? description : undefined;
    return {
      description: typeof description === "string" ? description : metadata?.description,
      feature: value,
      metadata,
    };
  }
  if (isCommandConfig(value)) return { description: value.description, feature: value.input, metadata: value };
  return {};
}

function isCommandConfig(value: unknown): value is CommandConfig<object, object> {
  return typeof value === "object" && value !== null && !isCommandFeature(value);
}

function applyCommandFeature(state: RouterState, route: Route, feature: CommandInputFeature): void {
  const inputOptions = feature.definition.options ?? [];
  const pattern = appendInputParams(route.pattern, feature.definition.params ?? []);
  for (const option of inputOptions) {
    validateOptionDefinition(option);
    assertUniqueRouteOption(route.options, option);
  }
  const metadata = feature.metadata ?? feature.definition.metadata;
  const aliases = [...route.metadata.aliases, ...metadataAliases(metadata)];
  assertValidAliasList(pattern.pattern, aliases);
  assertCommandPatternsAvailable(state, route, pattern.pattern, aliases);
  route.inputs.push(feature);
  route.options.push(...inputOptions);
  route.pattern = pattern;
  if (metadata) mergeCommandMetadata(state, route, metadata);
}

function emptyCommandMetadata(): MutableCommandMetadata {
  return { aliases: [], examples: [] };
}

function mergeCommandMetadata(state: RouterState, route: Route, metadata: CommandMetadata): void {
  const aliases = metadataAliases(metadata);
  assertValidAliasList(route.pattern.pattern, [...route.metadata.aliases, ...aliases]);
  assertCommandPatternsAvailable(state, route, route.pattern.pattern, [...route.metadata.aliases, ...aliases]);
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || key === "aliases" || key === "examples") continue;
    (route.metadata as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
  }
  if (metadata.description !== undefined) {
    const description = cleanDescription(metadata.description);
    route.description = description;
    if (description === undefined) {
      route.metadata.description = undefined;
    } else {
      route.metadata.description = description;
    }
  }
  if (metadata.aliases) addMetadataAliases(state, route, metadata.aliases);
  if (metadata.examples) route.metadata.examples.push(...metadata.examples);
  if (metadata.usage !== undefined) route.metadata.usage = metadata.usage.trim();
  if (metadata.group !== undefined) route.metadata.group = metadata.group.trim();
}

function addAliases(state: RouterState, route: Route, aliases: readonly string[]): void {
  const values = cleanAliases(aliases);
  const next = [...route.aliases, ...values];
  assertValidAliasList(route.pattern.pattern, next);
  assertCommandPatternsAvailable(state, route, route.pattern.pattern, next);
  route.aliases = next;
}

function addMetadataAliases(state: RouterState, route: Route, aliases: readonly string[]): void {
  const values = cleanAliases(aliases);
  const next = [...route.metadata.aliases, ...values];
  assertValidAliasList(route.pattern.pattern, next);
  assertCommandPatternsAvailable(state, route, route.pattern.pattern, next);
  route.metadata.aliases = next;
}

function metadataAliases(metadata: CommandMetadata | undefined): string[] {
  return cleanAliases(metadata?.aliases ?? []);
}

function cleanAliases(aliases: readonly string[]): string[] {
  const values: string[] = [];
  for (const alias of aliases) {
    validateCommandAliasPattern(alias);
    values.push(alias);
  }
  return values;
}

function cleanDescription(description: string): string | undefined {
  const value = description.trim();
  return value ? value : undefined;
}

function appendInputParams(pattern: CompiledPattern, params: readonly ParamDefinition[]): CompiledPattern {
  const existing = new Set(pattern.paramNames);
  const additions: string[] = [];

  for (const param of params) {
    const name = param.name.trim();
    if (!name) continue;
    if (existing.has(name)) throw new Error(`Duplicate command input param: ${name}`);
    existing.add(name);
    additions.push(paramToken({ ...param, name }));
  }

  return additions.length > 0 ? compilePattern(joinPattern([pattern.pattern, ...additions])) : pattern;
}

function paramToken(param: ParamDefinition): string {
  const rest = param.variadic ? "..." : "";
  if (param.required === false) return `[${rest}${param.name}]`;
  return `<${rest}${param.name}>`;
}

function addRouteOption(route: Route, definition: OptionDefinition): void {
  validateOptionDefinition(definition);
  assertUniqueRouteOption(route.options, definition);
  route.options.push(definition);
}

function assertUniqueRouteOption(options: readonly OptionDefinition[], definition: OptionDefinition): void {
  for (const existing of options) {
    if (existing.name === definition.name) throw new Error(`Duplicate command option: ${definition.name}`);
    const duplicateAlias = definition.aliases.find((alias) => existing.aliases.includes(alias));
    if (duplicateAlias) throw new Error(`Duplicate command option alias: ${duplicateAlias}`);
  }
}

function collectRouteEntries(
  state: RouterState,
  scope: RouteScope = emptyScope(),
  includeAliases = true,
  getCommandComposers?: () => readonly CommandComposer[],
  mountPath?: readonly string[],
): RouteEntry[] {
  const path = [...scope.path, ...(mountPath ?? pathSegments(state.name))];
  const options = [...scope.options, ...state.options];
  const errorHandlers = [...scope.errorHandlers, ...state.errorHandlers];
  const middleware = [...scope.middleware, ...resolveMiddleware(state.middleware, path, errorHandlers)];
  const ownEntries = state.routes.flatMap((route) => {
    applyCommandComposers(state, route, getCommandComposers?.() ?? []);
    const pattern = compilePattern(joinPattern([...path, route.pattern.pattern]));
    const aliases = aliasPatterns(route).map((alias) => compilePattern(joinPattern([...path, alias.pattern])));
    const canonical = {
      route,
      pattern,
      canonicalPattern: pattern,
      aliases,
      options: [...options, ...route.options],
      middleware: [
        ...middleware,
        ...route.middleware.map((item) => ({
          middleware: item,
          errorHandlers: routeErrorHandlers({ route, errorHandlers }),
        })),
      ],
      errorHandlers,
    };
    if (!includeAliases) return [canonical];
    return [
      canonical,
      ...aliases.map((alias) => ({
        ...canonical,
        pattern: alias,
      })),
    ];
  });
  const childEntries = state.children.flatMap((child) => {
    const childScopeErrorHandlers = [...errorHandlers, ...(child.errorHandlers ?? [])];
    const childMiddlewareErrorHandlers = [...childScopeErrorHandlers, ...child.state.errorHandlers];
    return collectRouteEntries(
      child.state,
      {
        path,
        options,
        middleware: [
          ...middleware,
          ...(child.middleware ?? []).map((item) => ({
            middleware: item,
            errorHandlers: [...childMiddlewareErrorHandlers].reverse(),
          })),
        ],
        errorHandlers: childScopeErrorHandlers,
      },
      includeAliases,
      getCommandComposers,
      child.path,
    );
  });
  return [...ownEntries, ...childEntries];
}

function collectOptionDefinitions(state: RouterState): OptionDefinition[] {
  return [...state.options, ...state.children.flatMap((child) => collectOptionDefinitions(child.state))];
}

function resolveMiddleware(
  entries: readonly MiddlewareEntry[],
  path: readonly string[],
  errorHandlers: readonly ErrorBoundary[],
): MiddlewareStep[] {
  const nearestFirstErrorHandlers = [...errorHandlers].reverse();
  return entries.map((entry) => {
    if (entry.kind === "middleware") return { middleware: entry.middleware, errorHandlers: nearestFirstErrorHandlers };
    return {
      middleware: scopedMiddleware([...path, ...entry.path], entry.middleware),
      errorHandlers: nearestFirstErrorHandlers,
    };
  });
}

function usageText(name: string, state: RouterState, getCommandComposers?: () => readonly CommandComposer[]): string {
  const entries = collectRouteEntries(state, emptyScope(), false, getCommandComposers).filter(
    (entry) => !entry.route.metadata.hidden,
  );
  const lines = [`Usage: ${name} <command>`, "", "Commands:"];
  for (const entry of entries) {
    lines.push(`  ${entry.pattern.pattern}${routeDetails(entry.route)}`);
  }
  return `${lines.join("\n")}\n`;
}

function helpRoutes(state: RouterState, getCommandComposers?: () => readonly CommandComposer[]): HelpRoute[] {
  return collectRouteEntries(state, emptyScope(), false, getCommandComposers).map((entry) => ({
    pattern: entry.pattern.pattern,
    ...(entry.route.description ? { description: entry.route.description } : {}),
    ...helpMetadata(entry.route, entry.pattern, entry.aliases),
    options: entry.options,
  }));
}

function helpMetadata(route: Route, pattern: CompiledPattern, aliases: readonly CompiledPattern[]): CommandMetadata {
  const {
    aliases: _aliases,
    description: _description,
    examples,
    usage: _usage,
    ...metadata
  } = cloneCommandMeta(route.metadata);
  return {
    ...metadata,
    ...(aliases.length > 0 ? { aliases: aliases.map((alias) => alias.pattern) } : {}),
    ...(examples && examples.length > 0 ? { examples } : {}),
    ...(route.metadata.usage
      ? { usage: mountedUsage(pattern.pattern, route.pattern.pattern, route.metadata.usage) }
      : {}),
  };
}

function routeDetails(route: Route): string {
  const details = [route.description, deprecatedText(route.metadata.deprecated)].filter(Boolean).join(" ");
  return details ? `  ${details}` : "";
}

function deprecatedText(value: boolean | string | undefined): string {
  if (value === true) return "deprecated";
  if (typeof value === "string") return `deprecated: ${value}`;
  return "";
}

function aliasPatterns(route: Route): CompiledPattern[] {
  assertValidAliases(route);
  return route.aliases.map((alias) => compilePattern(normalizeAliasPattern(route.pattern.pattern, alias)));
}

function assertValidAliases(route: Route): void {
  assertValidAliasList(route.pattern.pattern, route.aliases);
}

function assertValidAliasList(pattern: string, aliases: readonly string[]): void {
  const expected = paramSignature(pattern);
  const seen = new Set([pattern]);
  for (const alias of aliases) {
    const normalized = normalizeAliasPattern(pattern, alias);
    const actual = paramSignature(normalized);
    if (!equals(actual, expected)) {
      throw new Error(`Command alias params must match command params: ${alias}`);
    }
    if (seen.has(normalized)) throw new Error(`Duplicate command alias: ${alias}`);
    seen.add(normalized);
  }
}

function assertCommandPatternsAvailable(
  state: RouterState,
  route: Route,
  pattern: string,
  aliases: readonly string[],
): void {
  assertCommandPatternAvailable(state, route, pattern);
  for (const alias of aliases) assertCommandPatternAvailable(state, route, normalizeAliasPattern(pattern, alias));
}

function assertCommandPatternAvailable(state: RouterState, route: Route, pattern: string): void {
  const normalized = joinPattern(patternTokens(pattern));
  for (const existing of state.routes) {
    if (existing === route) continue;
    if (routePatternStrings(existing).includes(normalized)) {
      throw new Error(`Duplicate command pattern: ${normalized}`);
    }
  }
}

function routePatternStrings(route: Route): string[] {
  const aliases = [...route.metadata.aliases, ...route.aliases];
  return [
    joinPattern(patternTokens(route.pattern.pattern)),
    ...aliases.map((alias) => normalizeAliasPattern(route.pattern.pattern, alias)),
  ];
}

function normalizeAliasPattern(pattern: string, alias: string): string {
  const aliasTokens = patternTokens(alias);
  if (aliasTokens.some(isParamToken)) return joinPattern(aliasTokens);
  return joinPattern([...aliasTokens, ...paramSignature(pattern)]);
}

function paramSignature(pattern: string): string[] {
  return patternTokens(pattern).filter(isParamToken);
}

function mountedUsage(fullPattern: string, localPattern: string, usage: string): string {
  const prefix = mountPrefix(fullPattern, localPattern);
  if (prefix.length === 0) return usage;
  const usageTokens = patternTokens(usage);
  const fullTokens = patternTokens(fullPattern);
  if (startsWith(usageTokens, fullTokens) || startsWith(usageTokens.slice(1), fullTokens)) return usage;
  return joinPattern([...prefix, usage]);
}

function mountPrefix(fullPattern: string, localPattern: string): string[] {
  const full = patternTokens(fullPattern);
  const local = patternTokens(localPattern);
  if (local.length === 0 || full.length <= local.length) return [];
  return full.slice(0, full.length - local.length);
}

function emptyScope(): RouteScope {
  return { path: [], options: [], middleware: [], errorHandlers: [] };
}

function cleanRouterConfig(config: RouterOptions): Pick<RouterState, "name"> {
  const name = cleanSegment(config.name);
  return name ? { name } : {};
}

function isRouter(value: unknown): value is RouterRuntime {
  return typeof value === "object" && value !== null && routerTag in value;
}

function pathSegments(value: string | undefined): string[] {
  const segment = cleanSegment(value);
  return segment ? [segment] : [];
}

function cleanSegment(value: string | undefined): string | undefined {
  const segment = value?.trim();
  return segment ? segment : undefined;
}

function joinPattern(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function pathTokens(path: string): string[] {
  return path.split(" ");
}

function mountPathTokens(path: string): string[] {
  const tokens = pathTokens(path);
  if (path === "") throw new Error("Route path cannot be empty");
  if (tokens.some((token) => token === "")) throw new Error(`Invalid route path: ${path}`);
  const patternToken = tokens.find((token) => !isLiteralToken(token));
  if (patternToken) throw new Error(`Route path must contain only literal tokens: ${patternToken}`);
  return tokens;
}

function patternTokens(pattern: string): string[] {
  return pattern.trim().split(/\s+/).filter(Boolean);
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.every((value, index) => values[index] === value);
}

function equals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scopedMiddleware(path: readonly string[], middleware: Middleware): Middleware {
  return async (ctx, next) => {
    const patterns = scopedRoutePatterns.get(ctx) ?? [ctx.request.pattern];
    if (!patterns.some((pattern) => startsWith(patternTokens(pattern), path))) return next();
    return middleware(ctx, next);
  };
}

export function validateCommandPattern(pattern: string): void {
  validateCommandLikePattern(pattern, "command pattern");
}

function validateCommandAliasPattern(pattern: string): void {
  validateCommandLikePattern(pattern, "command alias");
}

function validateCommandLikePattern(pattern: string, label: "command pattern" | "command alias"): void {
  const tokens = pattern.split(" ");
  if (tokens.length === 0 || tokens.join(" ") !== pattern || tokens.some((token) => token === "")) {
    throw new Error(`Invalid ${label}: ${pattern}`);
  }

  const [command, ...params] = tokens;
  if (!command || !isLiteralToken(command) || params.some((token) => !isParamToken(token))) {
    throw new Error(`Invalid ${label}: ${pattern}`);
  }
}

export function validateMiddlewarePath(path: string): void {
  const tokens = path.split(" ");
  if (tokens.length === 0 || tokens.join(" ") !== path || tokens.some((token) => token === "")) {
    throw new Error(`Invalid middleware path: ${path}`);
  }

  if (tokens.some((token) => !isLiteralToken(token))) {
    throw new Error(`Invalid middleware path: ${path}`);
  }
}

function isLiteralToken(token: string): boolean {
  return token !== "" && !/[<>\[\]\s]/.test(token);
}

function isParamToken(token: string): boolean {
  const match = /^(?:<(\.\.\.)?([^<>\[\]\s]+)>|\[(\.\.\.)?([^<>\[\]\s]+)\])$/.exec(token);
  return Boolean(match);
}
