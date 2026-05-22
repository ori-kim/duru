import type { Awaitable, Simplify } from "./common.ts";
import type { RawParams } from "./pattern.ts";

export type ParsedOptionValue = boolean | string | string[];
export type RawOptionValue = unknown;
export type OptionValue = ParsedOptionValue;
export type RawOptions = Readonly<Record<string, RawOptionValue | undefined>>;
export type Options = Record<string, OptionValue | undefined>;

export type MergeOptions<TLeft extends object, TRight extends object> = Simplify<Omit<TLeft, keyof TRight> & TRight>;

export type OptionDefinition = {
  name: string;
  aliases: readonly string[];
  type: "boolean" | "value";
  description?: string;
};

export type ParsedOptions = {
  options: RawOptions;
  positionals: string[];
};

export type OptionFallbackInput = {
  option: OptionDefinition;
  argv: readonly string[];
  pattern: string;
  params: RawParams;
  options: RawOptions;
  positionals: readonly string[];
};

export type OptionFallbackProvider = (input: OptionFallbackInput) => Awaitable<unknown | undefined>;

export type OptionSpec<TSpec extends string> = string extends TSpec
  ? TSpec
  : TSpec extends ValidOptionSpec<TSpec>
    ? TSpec
    : InvalidOptionSpec<TSpec>;

export type OptionSpecOptions<TSpec extends string> = OptionName<TSpec> extends infer TName extends string
  ? Simplify<{ [K in TName]?: OptionSpecValue<TSpec> }>
  : Options;

type InvalidOptionSpec<TSpec extends string> = HasLongOption<TSpec> extends true
  ? `Invalid option spec "${TSpec}": option aliases must start with "-" and cannot be empty. Example: "--json" or "-j, --json".`
  : `Invalid option spec "${TSpec}": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".`;

type ValidOptionSpec<TSpec extends string> = TSpec extends Trim<TSpec>
  ? HasLongOption<TSpec> extends true
    ? ValidOptionAliases<TSpec> extends true
      ? TSpec
      : never
    : never
  : never;

type ValidOptionAliases<TSpec extends string> = TSpec extends `${infer Head},${infer Tail}`
  ? IsOptionAlias<OptionAliasToken<Head>> extends true
    ? ValidOptionAliases<Tail>
    : false
  : IsOptionAlias<OptionAliasToken<TSpec>>;

type HasLongOption<TSpec extends string> = TSpec extends `${infer Head},${infer Tail}`
  ? IsLongOptionAlias<OptionAliasToken<Head>> extends true
    ? true
    : HasLongOption<Tail>
  : IsLongOptionAlias<OptionAliasToken<TSpec>>;

type IsOptionAlias<TAlias extends string> = IsLongOptionAlias<TAlias> extends true ? true : IsShortOptionAlias<TAlias>;

type IsLongOptionAlias<TAlias extends string> = TAlias extends `--${infer Name}` ? IsOptionAliasName<Name> : false;

type IsShortOptionAlias<TAlias extends string> = TAlias extends `-${infer Name}`
  ? TAlias extends `--${string}`
    ? false
    : IsOptionAliasName<Name>
  : false;

type IsOptionAliasName<TName extends string> = TName extends ""
  ? false
  : TName extends
        | `-${string}`
        | `${string} ${string}`
        | `${string},${string}`
        | `${string}<${string}`
        | `${string}>${string}`
        | `${string}[${string}`
        | `${string}]${string}`
    ? false
    : true;

type OptionSpecValue<TSpec extends string> = TSpec extends
  | `${string}<${string}>${string}`
  | `${string}[${string}]${string}`
  ? string
  : boolean;

type OptionName<TSpec extends string> = CamelCase<StripNo<OptionSegment<TSpec>>>;

type OptionAliasToken<TValue extends string> = Trim<TValue> extends `${infer Head} ${string}` ? Head : Trim<TValue>;

type OptionSegment<TSpec extends string> = TSpec extends `${string}--${infer Rest}`
  ? TakeOptionToken<Rest>
  : TSpec extends `${string}-${infer Rest}`
    ? TakeOptionToken<Rest>
    : string;

type TakeOptionToken<TValue extends string> = Trim<TValue> extends `${infer Head},${string}`
  ? Head
  : Trim<TValue> extends `${infer Head} ${string}`
    ? Head
    : Trim<TValue>;

type StripNo<TValue extends string> = TValue extends `no-${infer Rest}` ? Rest : TValue;

type CamelCase<TValue extends string> = TValue extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : TValue;

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>;
type TrimLeft<TValue extends string> = TValue extends ` ${infer Rest}` ? TrimLeft<Rest> : TValue;
type TrimRight<TValue extends string> = TValue extends `${infer Rest} ` ? TrimRight<Rest> : TValue;
