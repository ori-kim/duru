import type { Awaitable } from "./common.ts";
import type { Options } from "./options.ts";
import type { RenderInput, RenderedOutput } from "./output.ts";
import type { Params } from "./pattern.ts";
import type { Request } from "./request.ts";

export type RendererContext<TOptions extends Options = Options, TParams extends object = Params> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
};

export type Renderer = {
  id: string;
  render(input: RenderInput, ctx: RendererContext): Awaitable<RenderedOutput>;
};
