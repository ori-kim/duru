import type { Options } from "./options.ts";
import type { OutputWriter } from "./output.ts";
import type { Params } from "./pattern.ts";
import type { Request } from "./request.ts";

export type Context<TOptions extends Options = Options, TParams extends object = Params> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
  output: OutputWriter;
  state: Map<string, unknown>;
  service<T>(key: string): T | undefined;
  setService<T>(key: string, value: T): void;
};
