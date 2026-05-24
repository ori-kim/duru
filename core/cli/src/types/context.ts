import type { EmptyObject } from "./common.ts";
import type { CliEventName, CliEventPayload, CliEventRecord } from "./event.ts";
import type { CommandMeta } from "./help.ts";
import type { Options, RawOptions } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params, RawParams } from "./pattern.ts";
import type { Request } from "./request.ts";
import type { ExitResult } from "./result.ts";

export type Context<
  TOptions extends object = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = {
  request: Request<TOptions, TParams>;
  raw: Request<RawOptions, RawParams>;
  params: TParams;
  options: TOptions;
  meta: Readonly<CommandMeta>;
  var: Partial<TValues>;
  emit<TName extends CliEventName>(name: TName, payload?: CliEventPayload<TName>): Promise<ActionResult>;
  events(): readonly CliEventRecord[];
  stream(value: unknown): Promise<void>;
  get<TKey extends keyof TValues & string>(key: TKey): TValues[TKey] | undefined;
  set<TKey extends keyof TValues & string>(key: TKey, value: TValues[TKey]): void;
  exit<TValue>(exitCode: number, result: TValue, ok?: boolean): ExitResult<TValue>;
  service<T>(key: string | symbol): T | undefined;
  setService<T>(key: string | symbol, value: T): void;
};
