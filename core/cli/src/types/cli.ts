import type { EmptyObject, MergeContext } from "./common.ts";
import type { CliEventHandler, CliEventName, CliEventPayload, CliEventRecord } from "./event.ts";
import type { CommandMetadata } from "./help.ts";
import type { CommandFeature } from "./input.ts";
import type { Middleware } from "./middleware.ts";
import type { MergeOptions, OptionSpec, OptionSpecOptions, Options } from "./options.ts";
import type { RenderedOutput } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";
import type { CliPlugin } from "./plugin.ts";
import type { Renderer } from "./renderer.ts";
import type { RouteErrorHandler } from "./route.ts";
import type { CommandBuilder, CommandConfig, CommandPattern, MiddlewarePath } from "./router.ts";

export type CliOptions = {
  name?: string;
};

export type Cli<TGlobalOptions extends Options = EmptyObject, TValues extends object = EmptyObject> = {
  option<TSpec extends string>(
    spec: OptionSpec<TSpec>,
    description?: string,
  ): Cli<MergeOptions<TGlobalOptions, OptionSpecOptions<TSpec>>, TValues>;
  use<TAddedOptions extends Options, TAddedValues extends object>(
    plugin: CliPlugin<TAddedOptions, TAddedValues>,
  ): Cli<MergeOptions<TGlobalOptions, TAddedOptions>, MergeContext<TValues, TAddedValues>>;
  route<TPath extends string, TAddedOptions extends Options, TAddedValues extends object>(
    path: MiddlewarePath<TPath>,
    app: Cli<TAddedOptions, TAddedValues>,
  ): Cli<MergeOptions<TGlobalOptions, TAddedOptions>, MergeContext<TValues, TAddedValues>>;
  use<TPath extends string>(
    path: MiddlewarePath<TPath>,
    middleware: Middleware<TGlobalOptions, Params, TValues>,
  ): Cli<TGlobalOptions, TValues>;
  use(middleware: Middleware<TGlobalOptions, Params, TValues>): Cli<TGlobalOptions, TValues>;
  renderer(renderer: Renderer): Cli<TGlobalOptions, TValues>;
  on<TName extends CliEventName>(
    name: TName,
    handler: CliEventHandler<TName, TGlobalOptions, TValues>,
  ): Cli<TGlobalOptions, TValues>;
  catch(
    handler: RouteErrorHandler<Record<string, unknown>, Record<string, unknown>, TValues>,
  ): Cli<TGlobalOptions, TValues>;
  notFound(handler: CliEventHandler<"notFound", TGlobalOptions, TValues>): Cli<TGlobalOptions, TValues>;
  emit<TName extends CliEventName>(name: TName, payload?: CliEventPayload<TName>): Promise<void>;
  command(): CommandBuilder<"", TGlobalOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string>(
    pattern: CommandPattern<TPattern>,
    description?: string,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string, TInputParams extends object, TInputOptions extends object>(
    pattern: CommandPattern<TPattern>,
    config: CommandConfig<TInputParams, TInputOptions>,
  ): CommandBuilder<
    TPattern,
    TGlobalOptions,
    TInputOptions,
    undefined,
    TValues,
    MergeContext<PatternParams<TPattern>, TInputParams>
  >;
  command<TPattern extends string>(
    pattern: CommandPattern<TPattern>,
    config: CommandConfig,
  ): CommandBuilder<TPattern, TGlobalOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string, TInputParams extends object, TInputOptions extends object>(
    pattern: CommandPattern<TPattern>,
    feature: CommandFeature<TInputParams, TInputOptions>,
    description?: string | CommandMetadata,
  ): CommandBuilder<
    TPattern,
    TGlobalOptions,
    TInputOptions,
    undefined,
    TValues,
    MergeContext<PatternParams<TPattern>, TInputParams>
  >;
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
