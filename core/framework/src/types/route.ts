import type { Awaitable } from "./common.ts";
import type { Context } from "./context.ts";
import type { Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";

export type RouteAction<
  TPattern extends string,
  TOptions extends Options = Options,
  TResult extends ActionResult = ActionResult,
> = (ctx: Context<TOptions, PatternParams<TPattern>>) => Awaitable<TResult>;

export type RoutePresenter<TValue, TOptions extends Options = Options, TParams extends object = Params> = (
  value: TValue,
  ctx: Context<TOptions, TParams>,
) => Awaitable<ActionResult>;

export type RouteRender<TValue, TOptions extends Options = Options, TParams extends object = Params> = RoutePresenter<
  TValue,
  TOptions,
  TParams
>;
