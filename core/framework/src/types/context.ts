import type { EmptyObject } from "./common.ts";
import type { CliEventName, CliEventPayload, CliEventRecord } from "./event.ts";
import type { Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params } from "./pattern.ts";
import type { Request } from "./request.ts";
import type { ExitResult } from "./result.ts";

export type Context<
  TOptions extends Options = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = {
  request: Request<TOptions, TParams>;
  params: TParams;
  options: TOptions;
  emit<TName extends CliEventName>(name: TName, payload?: CliEventPayload<TName>): Promise<ActionResult>;
  events(): readonly CliEventRecord[];
  get<TKey extends keyof TValues & string>(key: TKey): TValues[TKey] | undefined;
  set<TKey extends keyof TValues & string>(key: TKey, value: TValues[TKey]): void;
  exit<TValue>(exitCode: number, result: TValue, ok?: boolean): ExitResult<TValue>;
  state: Map<string, unknown>;
  service<T>(key: string): T | undefined;
  setService<T>(key: string, value: T): void;
};
