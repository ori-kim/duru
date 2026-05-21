import type { Simplify } from "./common.ts";

export type OptionValue = boolean | string | string[];
export type Options = Record<string, OptionValue | undefined>;

export type MergeOptions<TLeft extends Options, TRight extends Options> = Simplify<Omit<TLeft, keyof TRight> & TRight>;

export type OptionDefinition = {
  name: string;
  aliases: readonly string[];
  type: "boolean" | "value";
  description?: string;
};

export type ParsedOptions = {
  options: Options;
  positionals: string[];
};

export type OptionSpecOptions<TSpec extends string> = OptionName<TSpec> extends infer TName extends string
  ? Simplify<{ [K in TName]?: OptionSpecValue<TSpec> }>
  : Options;

type OptionSpecValue<TSpec extends string> = TSpec extends
  | `${string}<${string}>${string}`
  | `${string}[${string}]${string}`
  ? string
  : boolean;

type OptionName<TSpec extends string> = CamelCase<StripNo<OptionSegment<TSpec>>>;

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
