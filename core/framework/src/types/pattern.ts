import type { EmptyObject, Simplify } from "./common.ts";

export type Params = Record<string, string | string[] | undefined>;

export type CompiledPattern = {
  pattern: string;
  paramNames: readonly string[];
  match(argv: readonly string[]): { params: Params; positionals: readonly string[] } | undefined;
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

export type PatternParamTuple<TPattern extends string> = TPattern extends `${infer Head} ${infer Tail}`
  ? [...TokenParamTuple<Head>, ...PatternParamTuple<Trim<Tail>>]
  : TokenParamTuple<Trim<TPattern>>;

type TokenParamTuple<TToken extends string> = TToken extends `<...${string}>`
  ? [string[]]
  : TToken extends `[...${string}]`
    ? [string[]]
    : TToken extends `<${string}>`
      ? [string]
      : TToken extends `[${string}]`
        ? [string | undefined]
        : [];

type Trim<TValue extends string> = TrimLeft<TrimRight<TValue>>;
type TrimLeft<TValue extends string> = TValue extends ` ${infer Rest}` ? TrimLeft<Rest> : TValue;
type TrimRight<TValue extends string> = TValue extends `${infer Rest} ` ? TrimRight<Rest> : TValue;
