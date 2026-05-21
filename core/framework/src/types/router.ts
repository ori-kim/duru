import type { EmptyObject, MergeContext } from "./common.ts";
import type { HelpRoute } from "./help.ts";
import type { Middleware } from "./middleware.ts";
import type { MergeOptions, OptionDefinition, OptionSpecOptions, Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";
import type { CliPlugin } from "./plugin.ts";
import type { RouteAction, RoutePresenter, RouteRender } from "./route.ts";

export type CommandBuilder<
  TPattern extends string = string,
  TRouterOptions extends Options = Options,
  TLocalOptions extends Options = EmptyObject,
  TResult = undefined,
  TValues extends object = EmptyObject,
> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, MergeOptions<TLocalOptions, OptionSpecOptions<TSpec>>, TResult, TValues>;
  use(
    middleware: Middleware<MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues>;
  action<TResultNext extends ActionResult>(
    handler: RouteAction<TPattern, MergeOptions<TRouterOptions, TLocalOptions>, TResultNext, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, Awaited<TResultNext>, TValues>;
  text(
    handler: RoutePresenter<TResult, MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues>;
  json(
    handler: RoutePresenter<TResult, MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues>;
  render(
    handler: RouteRender<TResult, MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues>;
  render(
    format: string,
    handler: RouteRender<TResult, MergeOptions<TRouterOptions, TLocalOptions>, PatternParams<TPattern>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues>;
};

export type Router<TRouterOptions extends Options = EmptyObject, TValues extends object = EmptyObject> = CliPlugin<
  TRouterOptions,
  TValues
> & {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Router<MergeOptions<TRouterOptions, OptionSpecOptions<TSpec>>, TValues>;
  use<TChildOptions extends Options, TChildValues extends object>(
    router: Router<TChildOptions, TChildValues>,
  ): Router<MergeOptions<TRouterOptions, TChildOptions>, MergeContext<TValues, TChildValues>>;
  use(middleware: Middleware<TRouterOptions, Params, TValues>): Router<TRouterOptions, TValues>;
  command<TPattern extends string>(
    pattern: TPattern,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined, TValues>;
  middleware(getGlobalOptions: () => readonly OptionDefinition[]): Middleware;
  usage(name: string): string;
  helpRoutes(): readonly HelpRoute[];
};

export type RouterOptions = {
  name?: string;
  description?: string;
};
