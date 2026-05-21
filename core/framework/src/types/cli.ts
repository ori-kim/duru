import type { EmptyObject } from "./common.ts";
import type { Middleware } from "./middleware.ts";
import type { MergeOptions, OptionSpecOptions, Options } from "./options.ts";
import type { Output, RenderedOutput } from "./output.ts";
import type { CliPlugin } from "./plugin.ts";
import type { Renderer } from "./renderer.ts";
import type { CommandBuilder } from "./router.ts";

export type CliOptions<TGlobalOptions extends Options = Options> = {
  name?: string;
};

export type Cli<TGlobalOptions extends Options = EmptyObject> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Cli<MergeOptions<TGlobalOptions, OptionSpecOptions<TSpec>>>;
  use<TAddedOptions extends Options>(
    plugin: CliPlugin<TAddedOptions>,
  ): Cli<MergeOptions<TGlobalOptions, TAddedOptions>>;
  use(middleware: Middleware<TGlobalOptions>): Cli<TGlobalOptions>;
  renderer(renderer: Renderer): Cli<TGlobalOptions>;
  command<TPattern extends string>(
    pattern: TPattern,
    description?: string,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject>;
  run(argv?: readonly string[], options?: CliRunOptions): Promise<CliRunResult>;
};

export type CliRunResult = {
  ok: boolean;
  exitCode: number;
  outputs: readonly Output[];
  rendered?: RenderedOutput;
};

export type CliRunOptions = {
  renderer?: string;
  render?: boolean;
};
