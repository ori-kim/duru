export type Awaitable<T> = T | Promise<T>;

export type OptionValue = boolean | string | string[];
export type Options = Record<string, OptionValue | undefined>;
export type Params = Record<string, string | string[] | undefined>;
export type EmptyObject = Record<never, never>;
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type MergeOptions<TLeft extends Options, TRight extends Options> = Simplify<Omit<TLeft, keyof TRight> & TRight>;

export type Output =
  | { kind: "text"; text: string }
  | { kind: "data"; value: unknown }
  | { kind: "table"; rows: readonly Record<string, unknown>[] }
  | { kind: "log"; stream: "stdout" | "stderr"; text: string }
  | { kind: "task"; title: string; status: "running" | "done" | "failed"; message?: string }
  | { kind: "view"; value: unknown };

export type RenderedOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type Request<TOptions extends Options = Options, TParams extends object = Params> = {
  argv: readonly string[];
  pattern: string;
  params: TParams;
  options: TOptions;
  positionals: readonly string[];
};

export type OutputWriter = {
  emit(output: Output): void;
  text(text: string): void;
  data(value: unknown): void;
  table(rows: readonly Record<string, unknown>[]): void;
  log(text: string, stream?: "stdout" | "stderr"): void;
  task(title: string, status: "running" | "done" | "failed", message?: string): void;
  view(value: unknown): void;
  list(): readonly Output[];
};

export type Context<TOptions extends Options = Options, TParams extends object = Params> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
  output: OutputWriter;
  state: Map<string, unknown>;
  service<T>(key: string): T | undefined;
  setService<T>(key: string, value: T): void;
};

export type Middleware<TOptions extends Options = Options, TParams extends object = Params> = (
  ctx: Context<TOptions, TParams>,
  next: () => Promise<unknown>,
) => Awaitable<unknown>;
export type ActionResult = undefined | Output | readonly Output[] | string | number | boolean | Record<string, unknown>;
export type PatternActionArgs<TPattern extends string, TOptions extends Options = Options> = [
  ...PatternParamTuple<TPattern>,
  TOptions,
  Context<TOptions, PatternParams<TPattern>>,
];

export type RendererContext<TOptions extends Options = Options, TParams extends object = Params> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
};

export type Renderer = {
  id: string;
  render(outputs: readonly Output[], ctx: RendererContext): Awaitable<RenderedOutput>;
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

export type PatternParams<TPattern extends string> = Simplify<PatternParamObject<Trim<TPattern>>>;

export type OptionSpecOptions<TSpec extends string> = OptionName<TSpec> extends infer TName extends string
  ? Simplify<{ [K in TName]?: OptionSpecValue<TSpec> }>
  : Options;

type PatternParamTuple<TPattern extends string> = TPattern extends `${infer Head} ${infer Tail}`
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
