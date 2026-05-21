import type { EmptyObject, MergeContext } from "./common.ts";
import type { CliEventHandler, CliEventName, CliEventPayload, CliEventRecord } from "./event.ts";
import type { Middleware } from "./middleware.ts";
import type { MergeOptions, OptionSpecOptions, Options } from "./options.ts";
import type { RenderedOutput } from "./output.ts";
import type { Params } from "./pattern.ts";
import type { CliPlugin } from "./plugin.ts";
import type { Renderer } from "./renderer.ts";
import type { CommandBuilder } from "./router.ts";

export type CliOptions<TGlobalOptions extends Options = Options> = {
  name?: string;
};

export type Cli<TGlobalOptions extends Options = EmptyObject, TValues extends object = EmptyObject> = {
  option<TSpec extends string>(
    spec: TSpec,
    description?: string,
  ): Cli<MergeOptions<TGlobalOptions, OptionSpecOptions<TSpec>>, TValues>;
  use<TAddedOptions extends Options, TAddedValues extends object>(
    plugin: CliPlugin<TAddedOptions, TAddedValues>,
  ): Cli<MergeOptions<TGlobalOptions, TAddedOptions>, MergeContext<TValues, TAddedValues>>;
  use(middleware: Middleware<TGlobalOptions, Params, TValues>): Cli<TGlobalOptions, TValues>;
  renderer(renderer: Renderer): Cli<TGlobalOptions, TValues>;
  on<TName extends CliEventName>(
    name: TName,
    handler: CliEventHandler<TName, TGlobalOptions, TValues>,
  ): Cli<TGlobalOptions, TValues>;
  onError(handler: CliEventHandler<"error", TGlobalOptions, TValues>): Cli<TGlobalOptions, TValues>;
  notFound(handler: CliEventHandler<"notFound", TGlobalOptions, TValues>): Cli<TGlobalOptions, TValues>;
  emit<TName extends CliEventName>(name: TName, payload?: CliEventPayload<TName>): Promise<void>;
  command<TPattern extends string>(
    pattern: TPattern,
    description?: string,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject, undefined, TValues>;
  run(argv?: readonly string[], options?: CliRunOptions): Promise<CliRunResult>;
};

export type CliRunResult = {
  ok: boolean;
  exitCode: number;
  result: unknown;
  value: unknown;
  events: readonly CliEventRecord[];
  rendered?: RenderedOutput;
};

export type CliRunOptions = {
  renderer?: string;
  render?: boolean;
};
