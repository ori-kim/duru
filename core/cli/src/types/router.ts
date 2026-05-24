import type { EmptyObject, MergeContext } from "./common.ts";
import type { CommandExample, CommandMetadata, HelpRoute } from "./help.ts";
import type { CommandFeature } from "./input.ts";
import type { Middleware } from "./middleware.ts";
import type {
  MergeOptions,
  OptionDefinition,
  OptionFallbackProvider,
  OptionSpec,
  OptionSpecOptions,
  Options,
} from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, PatternParams } from "./pattern.ts";
import type { CliPlugin, CommandComposer } from "./plugin.ts";
import type { RouteActionForParams, RouteErrorHandler, RoutePresenter, RouteRender } from "./route.ts";

export type CommandBuilder<
  TPattern extends string = string,
  TRouterOptions extends object = Options,
  TLocalOptions extends object = EmptyObject,
  TResult = undefined,
  TValues extends object = EmptyObject,
  TParams extends object = PatternParams<TPattern>,
> = {
  meta(metadata: CommandMetadata): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  alias<TAlias extends string>(
    pattern: CommandAliasPattern<TAlias, TPattern>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  aliases<TAlias extends string>(
    ...patterns: CommandAliasPattern<TAlias, TPattern>[]
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  example(example: CommandExample): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  examples(
    ...examples: CommandExample[]
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  usage(usage: string): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  hidden(hidden?: boolean): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  deprecated(
    reason?: boolean | string,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  group(group: string): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  option<TSpec extends string>(
    spec: OptionSpec<TSpec>,
    description?: string,
  ): CommandBuilder<
    TPattern,
    TRouterOptions,
    MergeOptions<TLocalOptions, OptionSpecOptions<TSpec>>,
    TResult,
    TValues,
    TParams
  >;
  input<TInputParams extends object, TInputOptions extends object>(
    feature: CommandFeature<TInputParams, TInputOptions>,
  ): CommandBuilder<
    TPattern,
    TRouterOptions,
    MergeOptions<TLocalOptions, TInputOptions>,
    TResult,
    TValues,
    MergeContext<TParams, TInputParams>
  >;
  catch(
    handler: RouteErrorHandler<Record<string, unknown>, Record<string, unknown>, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  use(
    middleware: Middleware<MergeOptions<TRouterOptions, TLocalOptions>, TParams, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  action<TResultNext extends ActionResult>(
    handler: RouteActionForParams<TParams, MergeOptions<TRouterOptions, TLocalOptions>, TResultNext, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, Awaited<TResultNext>, TValues, TParams>;
  text(
    handler: RoutePresenter<TResult, MergeOptions<TRouterOptions, TLocalOptions>, TParams, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  json(
    handler: RoutePresenter<TResult, MergeOptions<TRouterOptions, TLocalOptions>, TParams, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  render(
    handler: RouteRender<TResult, MergeOptions<TRouterOptions, TLocalOptions>, TParams, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
  render(
    format: string,
    handler: RouteRender<TResult, MergeOptions<TRouterOptions, TLocalOptions>, TParams, TValues>,
  ): CommandBuilder<TPattern, TRouterOptions, TLocalOptions, TResult, TValues, TParams>;
};

export type CommandConfig<
  TInputParams extends object = EmptyObject,
  TInputOptions extends object = EmptyObject,
> = CommandMetadata &
  (keyof TInputParams extends never
    ? keyof TInputOptions extends never
      ? { input?: CommandFeature<TInputParams, TInputOptions> }
      : { input: CommandFeature<TInputParams, TInputOptions> }
    : { input: CommandFeature<TInputParams, TInputOptions> });

export type Router<TRouterOptions extends Options = EmptyObject, TValues extends object = EmptyObject> = CliPlugin<
  TRouterOptions,
  TValues
> & {
  option<TSpec extends string>(
    spec: OptionSpec<TSpec>,
    description?: string,
  ): Router<MergeOptions<TRouterOptions, OptionSpecOptions<TSpec>>, TValues>;
  use<TChildOptions extends Options, TChildValues extends object>(
    router: Router<TChildOptions, TChildValues>,
  ): Router<MergeOptions<TRouterOptions, TChildOptions>, MergeContext<TValues, TChildValues>>;
  route<TPath extends string, TChildOptions extends Options, TChildValues extends object>(
    path: MiddlewarePath<TPath>,
    router: Router<TChildOptions, TChildValues>,
    middleware?: readonly Middleware[],
    errorHandlers?: readonly RouteErrorHandler[],
    optionFallbacks?: readonly OptionFallbackProvider[],
  ): Router<MergeOptions<TRouterOptions, TChildOptions>, MergeContext<TValues, TChildValues>>;
  use<TPath extends string>(
    path: MiddlewarePath<TPath>,
    middleware: Middleware<TRouterOptions, Params, TValues>,
  ): Router<TRouterOptions, TValues>;
  use(middleware: Middleware<TRouterOptions, Params, TValues>): Router<TRouterOptions, TValues>;
  onError(
    handler: RouteErrorHandler<Record<string, unknown>, Record<string, unknown>, TValues>,
  ): Router<TRouterOptions, TValues>;
  command(): CommandBuilder<"", TRouterOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string>(
    pattern: CommandPattern<TPattern>,
    description?: string,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string, TInputParams extends object, TInputOptions extends object>(
    pattern: CommandPattern<TPattern>,
    config: CommandConfig<TInputParams, TInputOptions>,
  ): CommandBuilder<
    TPattern,
    TRouterOptions,
    TInputOptions,
    undefined,
    TValues,
    MergeContext<PatternParams<TPattern>, TInputParams>
  >;
  command<TPattern extends string>(
    pattern: CommandPattern<TPattern>,
    config: CommandConfig,
  ): CommandBuilder<TPattern, TRouterOptions, EmptyObject, undefined, TValues>;
  command<TPattern extends string, TInputParams extends object, TInputOptions extends object>(
    pattern: CommandPattern<TPattern>,
    feature: CommandFeature<TInputParams, TInputOptions>,
    description?: string | CommandMetadata,
  ): CommandBuilder<
    TPattern,
    TRouterOptions,
    TInputOptions,
    undefined,
    TValues,
    MergeContext<PatternParams<TPattern>, TInputParams>
  >;
  middleware(
    getGlobalOptions: () => readonly OptionDefinition[],
    getCommandComposers?: () => readonly CommandComposer[],
    getOptionFallbacks?: () => readonly OptionFallbackProvider[],
  ): Middleware;
  usage(name: string, getCommandComposers?: () => readonly CommandComposer[]): string;
  helpRoutes(getCommandComposers?: () => readonly CommandComposer[]): readonly HelpRoute[];
};

export type RouterOptions = {
  name?: string;
};

export type CommandPattern<TPattern extends string> = string extends TPattern
  ? TPattern
  : TPattern extends ValidCommandPattern<TPattern>
    ? TPattern
    : InvalidCommandPattern<TPattern>;

export type MiddlewarePath<TPath extends string> = string extends TPath
  ? TPath
  : TPath extends ValidMiddlewarePath<TPath>
    ? TPath
    : InvalidMiddlewarePath<TPath>;

type CommandAliasPattern<TAlias extends string, TPattern extends string> = string extends TAlias
  ? TAlias
  : TAlias extends ValidCommandPattern<TAlias>
    ? AliasParamsMatch<TAlias, TPattern> extends true
      ? TAlias
      : `Invalid command alias "${TAlias}": when alias includes params, they must exactly match the command params. Use a literal alias like "rm" or repeat the same params.`
    : InvalidCommandAliasPattern<TAlias>;

type InvalidCommandPattern<TPattern extends string> = HasSpacingIssue<TPattern> extends true
  ? `Invalid command pattern "${TPattern}": remove leading, trailing, or repeated spaces. Example: "run <name> [...args]".`
  : TPattern extends `${infer Head} ${infer Tail}`
    ? IsLiteralToken<Head> extends true
      ? ValidCommandTail<Tail> extends true
        ? never
        : `Invalid command pattern "${TPattern}": after the command name, only params like <name>, [name], <...args>, or [...args] are allowed. Extra literal subcommands are not allowed.`
      : `Invalid command pattern "${TPattern}": first token must be a literal command name without <>, [], or spaces. Example: "run <name>".`
    : `Invalid command pattern "${TPattern}": first token must be a literal command name without <>, [], or spaces. Example: "run <name>".`;

type InvalidCommandAliasPattern<TAlias extends string> = HasSpacingIssue<TAlias> extends true
  ? `Invalid command alias "${TAlias}": remove leading, trailing, or repeated spaces. Example: "rm" or "rm <name>".`
  : TAlias extends `${infer Head} ${infer Tail}`
    ? IsLiteralToken<Head> extends true
      ? ValidCommandTail<Tail> extends true
        ? never
        : `Invalid command alias "${TAlias}": after the alias name, only params like <name>, [name], <...args>, or [...args] are allowed. Extra literal subcommands are not allowed.`
      : `Invalid command alias "${TAlias}": first token must be a literal alias name without <>, [], or spaces. Example: "rm".`
    : `Invalid command alias "${TAlias}": first token must be a literal alias name without <>, [], or spaces. Example: "rm".`;

type InvalidMiddlewarePath<TPath extends string> = TPath extends ""
  ? `Invalid middleware path: path cannot be empty. Use a literal path like "run".`
  : HasSpacingIssue<TPath> extends true
    ? `Invalid middleware path "${TPath}": remove leading, trailing, or repeated spaces. Example: "run" or "admin run".`
    : `Invalid middleware path "${TPath}": only literal command path tokens are allowed; params like <name> or [name] are not allowed.`;

type ValidCommandPattern<TPattern extends string> = TPattern extends Trim<TPattern>
  ? TPattern extends `${infer Head} ${infer Tail}`
    ? IsLiteralToken<Head> extends true
      ? ValidCommandTail<Tail> extends true
        ? TPattern
        : never
      : never
    : IsLiteralToken<TPattern> extends true
      ? TPattern
      : never
  : never;

type ValidCommandTail<TPattern extends string> = TPattern extends `${infer Head} ${infer Tail}`
  ? IsParamToken<Head> extends true
    ? ValidCommandTail<Tail>
    : false
  : IsParamToken<TPattern>;

type AliasParamsMatch<TAlias extends string, TPattern extends string> = ParamSignature<TAlias> extends []
  ? true
  : SameParamSignature<ParamSignature<TAlias>, ParamSignature<TPattern>>;

type ParamSignature<TPattern extends string> = TPattern extends `${infer Head} ${infer Tail}`
  ? IsParamToken<Head> extends true
    ? [Head, ...ParamSignature<Tail>]
    : ParamSignature<Tail>
  : IsParamToken<TPattern> extends true
    ? [TPattern]
    : [];

type SameParamSignature<TLeft extends readonly string[], TRight extends readonly string[]> = TLeft extends [
  infer LeftHead extends string,
  ...infer LeftTail extends string[],
]
  ? TRight extends [infer RightHead extends string, ...infer RightTail extends string[]]
    ? LeftHead extends RightHead
      ? RightHead extends LeftHead
        ? SameParamSignature<LeftTail, RightTail>
        : false
      : false
    : false
  : TRight extends []
    ? true
    : false;

type ValidMiddlewarePath<TPath extends string> = TPath extends Trim<TPath>
  ? TPath extends ""
    ? never
    : TPath extends `${infer Head} ${infer Tail}`
      ? IsLiteralToken<Head> extends true
        ? ValidMiddlewarePath<Tail> extends never
          ? never
          : TPath
        : never
      : IsLiteralToken<TPath> extends true
        ? TPath
        : never
  : never;

type IsLiteralToken<TToken extends string> = TToken extends ""
  ? false
  : TToken extends `${string}<${string}` | `${string}>${string}` | `${string}[${string}` | `${string}]${string}`
    ? false
    : true;

type IsParamToken<TToken extends string> = TToken extends `<...${infer RequiredRestName}>`
  ? IsParamName<RequiredRestName>
  : TToken extends `[...${infer OptionalRestName}]`
    ? IsParamName<OptionalRestName>
    : TToken extends `<${infer RequiredName}>`
      ? IsParamName<RequiredName>
      : TToken extends `[${infer OptionalName}]`
        ? IsParamName<OptionalName>
        : false;

type IsParamName<TName extends string> = TName extends ""
  ? false
  : TName extends
        | `${string} ${string}`
        | `${string}<${string}`
        | `${string}>${string}`
        | `${string}[${string}`
        | `${string}]${string}`
    ? false
    : true;

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>;
type TrimLeft<TValue extends string> = TValue extends ` ${infer Rest}` ? TrimLeft<Rest> : TValue;
type TrimRight<TValue extends string> = TValue extends `${infer Rest} ` ? TrimRight<Rest> : TValue;
type HasSpacingIssue<TValue extends string> = TValue extends Trim<TValue>
  ? TValue extends `${string}  ${string}`
    ? true
    : false
  : true;
