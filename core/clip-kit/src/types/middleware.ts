import type { Awaitable, EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { Options } from "./options.ts";
import type { Params } from "./pattern.ts";

export type Middleware<
  TOptions extends object = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = (ctx: Context<TOptions, TParams, TValues>, next: () => Promise<unknown>) => Awaitable<unknown>;
