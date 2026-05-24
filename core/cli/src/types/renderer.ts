import type { Awaitable } from "./common.ts";
import type { Options } from "./options.ts";
import type { RenderInput, RenderedOutput } from "./output.ts";
import type { Params } from "./pattern.ts";
import type { Request } from "./request.ts";

export type RendererIO = {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  stdin: NodeJS.ReadStream;
  isTTY: boolean;
};

export type RendererContext<TOptions extends object = Options, TParams extends object = Params> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
  io: RendererIO;
};

export type Renderer = {
  id: string;
  render(input: RenderInput, ctx: RendererContext): Awaitable<RenderedOutput>;
  stream?(value: unknown, ctx: RendererContext): Awaitable<void>;
};
