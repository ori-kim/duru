import type { Awaitable, EmptyObject } from "./common.ts";
import type { Middleware } from "./middleware.ts";
import type { MergeOptions, OptionDefinition, OptionSpecOptions, Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { PatternParams } from "./pattern.ts";
import type { CliPlugin } from "./plugin.ts";
import type { PatternActionArgs, RouteRender } from "./route.ts";

export type CommandBuilder<
  TPattern extends string = string,
  TRouterOptions extends Options = Options,
  TLocalOptions extends Options = EmptyObject,
  TResult = undefined,
> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, MergeOptions<TLocalOptions, OptionSpecOptions<TSpec>>, TResult>;
  use(
    middleware: Middleware<MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult>;
  action<TResultNext extends ActionResult>(
    handler: (
      ...args: PatternActionArgs<TPattern, MergeOptions<TRouterOptions, TLocalOptions>>
    ) => Awaitable<TResultNext>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, Awaited<TResultNext>>;
  render(
    handler: RouteRender<TResult, MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult>;
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
