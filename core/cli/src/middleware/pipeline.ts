import type { Context, Middleware } from "../types/index.ts";

export async function runPipeline(
  middleware: readonly Middleware[],
  ctx: Context,
  action: () => Promise<unknown> | unknown,
): Promise<unknown> {
  let index = -1;

  async function dispatch(nextIndex: number): Promise<unknown> {
    if (nextIndex <= index) throw new Error("next() called multiple times");
    index = nextIndex;
    const fn = middleware[nextIndex];
    return fn ? fn(ctx, () => dispatch(nextIndex + 1)) : action();
  }

  return dispatch(0);
}
