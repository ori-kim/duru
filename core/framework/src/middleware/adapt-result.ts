import type { Awaitable, Context, Middleware } from "../types/index.ts";

export type ResultAdapter<TValue = unknown> = {
  when?(ctx: Context): boolean;
  match(value: unknown, ctx: Context): value is TValue;
  adapt(value: TValue, ctx: Context): Awaitable<unknown>;
};

export function adaptResult<TValue>(adapter: ResultAdapter<TValue>): Middleware {
  return async (ctx, next) => {
    const result = await next();
    if (adapter.when && !adapter.when(ctx)) return result;
    if (!adapter.match(result, ctx)) return result;
    return adapter.adapt(result, ctx);
  };
}
