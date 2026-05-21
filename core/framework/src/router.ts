import { type OptionDefinition, parseOptionSpec, parseOptions } from "./options.ts";
import { normalizeActionResult } from "./output.ts";
import { type CompiledPattern, compilePattern } from "./pattern.ts";
import { type CliPlugin, createPlugin } from "./plugin.ts";
import type {
  ActionResult,
  Context,
  EmptyObject,
  MergeOptions,
  Middleware,
  OptionSpecOptions,
  Options,
  PatternActionArgs,
  PatternParams,
} from "./types.ts";

type Action = (...args: unknown[]) => Promise<ActionResult> | ActionResult;

type Route = {
  pattern: CompiledPattern;
  description?: string;
  options: OptionDefinition[];
  middleware: Middleware[];
  action?: Action;
};

export type CommandBuilder<
  TPattern extends string = string,
  TRouterOptions extends Options = Options,
  TLocalOptions extends Options = EmptyObject,
> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, MergeOptions<TLocalOptions, OptionSpecOptions<TSpec>>>;
  use(
    middleware: Middleware<MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions>;
  action(
    handler: (
      ...args: PatternActionArgs<TPattern, MergeOptions<TRouterOptions, TLocalOptions>>
    ) => Promise<ActionResult> | ActionResult,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions>;
};

export type Router<TRouterOptions extends Options = EmptyObject> = CliPlugin<TRouterOptions> & {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Router<MergeOptions<TRouterOptions, OptionSpecOptions<TSpec>>>;
  use(middleware: Middleware<TRouterOptions>): Router<TRouterOptions>;
  command<TPattern extends string>(
    pattern: TPattern,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject>;
  middleware(getGlobalOptions: () => readonly OptionDefinition[]): Middleware;
  usage(name: string): string;
};

export function createRouter<TRouterOptions extends Options = EmptyObject>(): Router<TRouterOptions> {
  const routes: Route[] = [];
  const options: OptionDefinition[] = [];
  const middleware: Middleware[] = [];

  const router = {
    option<TSpec extends string>(spec: TSpec, description?: string) {
      options.push(parseOptionSpec(spec, description));
      return router as never;
    },
    use(fn: Middleware) {
      middleware.push(fn);
      return router as never;
    },
    command<TPattern extends string>(pattern: TPattern, description?: string) {
      const route: Route = { pattern: compilePattern(pattern), description, options: [], middleware: [] };
      routes.push(route);
      return createCommandBuilder<TPattern>(route);
    },
    middleware(getGlobalOptions: () => readonly OptionDefinition[]) {
      return createRouterMiddleware(routes, middleware, options, getGlobalOptions);
    },
    usage(name: string) {
      return usageText(name, routes);
    },
    ...createPlugin<TRouterOptions>((api) => {
      for (const item of options) api.option(item);
      api.middleware(createRouterMiddleware(routes, middleware, options, api.options));
      api.usage((name) => usageText(name, routes));
    }),
  };

  return router as unknown as Router<TRouterOptions>;

  function createCommandBuilder<TPattern extends string>(
    route: Route,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject> {
    const builder: CommandBuilder<TPattern, TRouterOptions, Options> = {
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
}

function createRouterMiddleware(
  routes: readonly Route[],
  routerMiddleware: readonly Middleware[],
  routerOptions: readonly OptionDefinition[],
  getGlobalOptions: () => readonly OptionDefinition[],
): Middleware {
  return async (ctx, next) => {
    for (const route of routes) {
      const parsed = parseOptions(ctx.request.argv, [...getGlobalOptions(), ...routerOptions, ...route.options]);
      const match = route.pattern.match(parsed.positionals);
      if (!match) continue;
      ctx.request = { ...ctx.request, pattern: route.pattern.pattern, params: match.params, options: parsed.options };
      ctx.params = match.params;
      ctx.options = parsed.options;
      ctx.state.set("handled", true);
      return runPipeline([...routerMiddleware, ...route.middleware], ctx, async () => {
        const result = await runAction(route, ctx);
        for (const output of normalizeActionResult(result)) ctx.output.emit(output);
      });
    }
    return next();
  };
}

async function runAction(route: Route, ctx: Context): Promise<ActionResult> {
  const args = route.pattern.paramNames.map((name) => ctx.params[name]);
  return route.action?.(...args, ctx.options, ctx);
}

async function runPipeline(middleware: readonly Middleware[], ctx: Context, action: () => Promise<unknown>) {
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
