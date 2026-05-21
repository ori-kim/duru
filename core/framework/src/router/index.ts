import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptionSpec, parseOptions } from "../options/index.ts";
import { compilePattern } from "../pattern/index.ts";
import { createPlugin } from "../plugin/index.ts";
import type {
  ActionResult,
  Awaitable,
  CommandBuilder,
  CompiledPattern,
  Context,
  EmptyObject,
  Middleware,
  OptionDefinition,
  Options,
  RoutePresenter,
  Router,
  RouterOptions,
} from "../types/index.ts";

type Action = (ctx: Context) => Awaitable<ActionResult>;
type RouteRenderer = RoutePresenter<ActionResult>;
const routerTag = Symbol("clip.router");
export const routeResultStateKey = "clip.routeResult";

export type RouteResultState = {
  result: ActionResult;
  presenters: ReadonlyMap<string, RouteRenderer>;
};

type Route = {
  pattern: CompiledPattern;
  description?: string;
  options: OptionDefinition[];
  middleware: Middleware[];
  action?: Action;
  presenters: Map<string, RouteRenderer>;
};

type RouterState = {
  name?: string;
  description?: string;
  routes: Route[];
  options: OptionDefinition[];
  middleware: Middleware[];
  children: RouterState[];
};

type RouteEntry = {
  route: Route;
  pattern: CompiledPattern;
  options: readonly OptionDefinition[];
  middleware: readonly Middleware[];
};

type RouteScope = {
  path: readonly string[];
  options: readonly OptionDefinition[];
  middleware: readonly Middleware[];
};

type RouterRuntime = Router<Options> & { readonly [routerTag]: RouterState };

export function createRouter<TRouterOptions extends Options = EmptyObject>(
  config: RouterOptions = {},
): Router<TRouterOptions> {
  const state: RouterState = {
    ...cleanRouterConfig(config),
    routes: [],
    options: [],
    middleware: [],
    children: [],
  };

  const router = {
    option<TSpec extends string>(spec: TSpec, description?: string) {
      state.options.push(parseOptionSpec(spec, description));
      return router as never;
    },
    use(item: Middleware | Router<Options>) {
      if (isRouter(item)) {
        state.children.push(item[routerTag]);
        return router as never;
      }
      state.middleware.push(item as Middleware);
      return router as never;
    },
    command<TPattern extends string>(pattern: TPattern, description?: string) {
      const route: Route = {
        pattern: compilePattern(pattern),
        description,
        options: [],
        middleware: [],
        presenters: new Map(),
      };
      state.routes.push(route);
      return createCommandBuilder<TPattern>(route);
    },
    middleware(getGlobalOptions: () => readonly OptionDefinition[]) {
      return createRouterMiddleware(state, getGlobalOptions);
    },
    usage(name: string) {
      return usageText(name, state);
    },
    ...createPlugin<TRouterOptions>((api) => {
      for (const item of collectOptionDefinitions(state)) api.option(item);
      api.middleware(createRouterMiddleware(state, api.options));
      api.usage((name) => usageText(name, state));
    }),
    [routerTag]: state,
  };

  return router as unknown as Router<TRouterOptions>;

  function createCommandBuilder<TPattern extends string>(
    route: Route,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined> {
    const builder = {
      option(spec: string, description?: string) {
        route.options.push(parseOptionSpec(spec, description));
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
    return builder as unknown as CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined>;
  }
}

function createRouterMiddleware(state: RouterState, getGlobalOptions: () => readonly OptionDefinition[]): Middleware {
  return async (ctx, next) => {
    for (const entry of collectRouteEntries(state)) {
      const parsed = parseOptions(ctx.request.argv, [...getGlobalOptions(), ...entry.options]);
      const match = entry.pattern.match(parsed.positionals);
      if (!match) continue;
      ctx.request = { ...ctx.request, pattern: entry.pattern.pattern, params: match.params, options: parsed.options };
      ctx.params = match.params;
      ctx.options = parsed.options;
      ctx.state.set("handled", true);
      return runPipeline(entry.middleware, ctx, async () => {
        const result = await runAction(entry.route, ctx);
        ctx.state.set(routeResultStateKey, {
          result,
          presenters: entry.route.presenters,
        } satisfies RouteResultState);
      });
    }
    return next();
  };
}

async function runAction(route: Route, ctx: Context): Promise<ActionResult> {
  return route.action?.(ctx);
}

function collectRouteEntries(state: RouterState, scope: RouteScope = emptyScope()): RouteEntry[] {
  const path = [...scope.path, ...pathSegments(state.name)];
  const options = [...scope.options, ...state.options];
  const middleware = [...scope.middleware, ...state.middleware];
  const ownEntries = state.routes.map((route) => ({
    route,
    pattern: compilePattern(joinPattern([...path, route.pattern.pattern])),
    options: [...options, ...route.options],
    middleware: [...middleware, ...route.middleware],
  }));
  const childEntries = state.children.flatMap((child) => collectRouteEntries(child, { path, options, middleware }));
  return [...ownEntries, ...childEntries];
}

function collectOptionDefinitions(state: RouterState): OptionDefinition[] {
  return [...state.options, ...state.children.flatMap(collectOptionDefinitions)];
}

function usageText(name: string, state: RouterState): string {
  const entries = collectRouteEntries(state);
  const lines = [`Usage: ${name} <command>`, "", "Commands:"];
  for (const entry of entries) {
    lines.push(`  ${entry.pattern.pattern}${entry.route.description ? `  ${entry.route.description}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

function emptyScope(): RouteScope {
  return { path: [], options: [], middleware: [] };
}

function cleanRouterConfig(config: RouterOptions): Pick<RouterState, "name" | "description"> {
  return {
    ...(cleanSegment(config.name) ? { name: cleanSegment(config.name) } : {}),
    ...(config.description ? { description: config.description } : {}),
  };
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
