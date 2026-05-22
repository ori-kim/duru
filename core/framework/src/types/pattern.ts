import type { EmptyObject, Simplify } from "./common.ts";

export type ParamValue = string | string[] | undefined;
export type RawParamValue = string | readonly string[] | undefined;
export type RawParams = Readonly<Record<string, RawParamValue>>;
export type Params = Record<string, ParamValue>;

export type CompiledPattern = {
  pattern: string;
  paramNames: readonly string[];
  match(argv: readonly string[]): { params: RawParams; positionals: readonly string[] } | undefined;
};

export type PatternParams<TPattern extends string> = Simplify<PatternParamObject<Trim<TPattern>>>;

type PatternParamObject<TPattern extends string> = TPattern extends ""
  ? EmptyObject
  : TPattern extends `${infer Head} ${infer Tail}`
    ? TokenParamObject<Head> & PatternParamObject<Trim<Tail>>
    : TokenParamObject<TPattern>;

type TokenParamObject<TToken extends string> = TToken extends `<...${infer Name}>`
  ? { [K in Name]: string[] }
  : TToken extends `[...${infer Name}]`
    ? { [K in Name]: string[] }
    : TToken extends `<${infer Name}>`
      ? { [K in Name]: string }
      : TToken extends `[${infer Name}]`
        ? { [K in Name]?: string }
        : EmptyObject;

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>;
type TrimLeft<TValue extends string> = TValue extends ` ${infer Rest}` ? TrimLeft<Rest> : TValue;
type TrimRight<TValue extends string> = TValue extends `${infer Rest} ` ? TrimRight<Rest> : TValue;
