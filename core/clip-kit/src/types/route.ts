import type { Awaitable, EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";

export type RouteAction<
  TPattern extends string,
  TOptions extends object = Options,
  TResult extends ActionResult = ActionResult,
  TValues extends object = EmptyObject,
> = RouteActionForParams<PatternParams<TPattern>, TOptions, TResult, TValues>;

export type RouteActionForParams<
  TParams extends object,
  TOptions extends object = Options,
  TResult extends ActionResult = ActionResult,
  TValues extends object = EmptyObject,
> = (ctx: Context<TOptions, TParams, TValues>) => Awaitable<TResult>;

export type RouteErrorContext<
  TOptions extends object = Record<string, unknown>,
  TParams extends object = Record<string, unknown>,
  TValues extends object = EmptyObject,
> = Context<TOptions, TParams, TValues> & {
  error: unknown;
};

export type RouteErrorHandler<
  TOptions extends object = Record<string, unknown>,
  TParams extends object = Record<string, unknown>,
  TValues extends object = EmptyObject,
> = (ctx: RouteErrorContext<TOptions, TParams, TValues>) => Awaitable<ActionResult>;

export type RoutePresenter<
  TValue,
  TOptions extends object = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = (value: TValue, ctx: Context<TOptions, TParams, TValues>) => Awaitable<ActionResult>;

export type RouteRender<
  TValue,
  TOptions extends object = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = RoutePresenter<TValue, TOptions, TParams, TValues>;
