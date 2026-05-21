import type { Awaitable } from "./common.ts";
import type { Context } from "./context.ts";
import type { Options } from "./options.ts";
import type { Params } from "./pattern.ts";

export type Middleware<TOptions extends Options = Options, TParams extends object = Params> = (
  ctx: Context<TOptions, TParams>,
  next: () => Promise<unknown>,
) => Awaitable<unknown>;
