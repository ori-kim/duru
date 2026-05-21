import type { Options } from "./options.ts";
import type { Params } from "./pattern.ts";

export type Request<TOptions extends Options = Options, TParams extends object = Params> = {
  argv: readonly string[];
  pattern: string;
  params: TParams;
  options: TOptions;
  positionals: readonly string[];
};
