import type { Awaitable, EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";

export type RouteAction<
  TPattern extends string,
  TOptions extends Options = Options,
  TResult extends ActionResult = ActionResult,
  TValues extends object = EmptyObject,
> = (ctx: Context<TOptions, PatternParams<TPattern>, TValues>) => Awaitable<TResult>;

export type RoutePresenter<
  TValue,
  TOptions extends Options = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = (value: TValue, ctx: Context<TOptions, TParams, TValues>) => Awaitable<ActionResult>;

export type RouteRender<
  TValue,
  TOptions extends Options = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = RoutePresenter<TValue, TOptions, TParams, TValues>;
