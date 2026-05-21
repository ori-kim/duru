import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptionSpec, parseOptions } from "../options/index.ts";
import { normalizeActionResult } from "../output/index.ts";
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
  Router,
} from "../types/index.ts";

type Action = (...args: unknown[]) => Awaitable<ActionResult>;
type RouteRenderer = (value: ActionResult, ctx: Context) => Awaitable<ActionResult>;

type Route = {
  pattern: CompiledPattern;
  description?: string;
  options: OptionDefinition[];
  middleware: Middleware[];
  action?: Action;
  render?: RouteRenderer;
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
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined> {
    const builder: CommandBuilder<TPattern, TRouterOptions, Options, ActionResult> = {
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
      render(handler) {
        route.render = handler as unknown as RouteRenderer;
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
        const rendered = route.render ? await route.render(result, ctx) : result;
        for (const output of normalizeActionResult(rendered)) ctx.output.emit(output);
      });
    }
    return next();
  };
}

async function runAction(route: Route, ctx: Context): Promise<ActionResult> {
  const args = route.pattern.paramNames.map((name) => ctx.params[name]);
  return route.action?.(...args, ctx.options, ctx);
}

function usageText(name: string, routes: readonly Route[]): string {
  const lines = [`Usage: ${name} <command>`, "", "Commands:"];
  for (const route of routes) {
    lines.push(`  ${route.pattern.pattern}${route.description ? `  ${route.description}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
