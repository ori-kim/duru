import type { Awaitable, EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { HelpDocument } from "./help.ts";
import type { Options } from "./options.ts";
import type { ActionResult } from "./output.ts";
import type { Params } from "./pattern.ts";

export type CliEventMap = {
  error: { error: unknown };
  notFound: { argv: readonly string[] };
  help: { document: HelpDocument };
};

export type CliEventName = keyof CliEventMap | (string & {});

export type CliEventPayload<TName extends CliEventName> = TName extends keyof CliEventMap
  ? CliEventMap[TName]
  : unknown;

export type CliEventRecord<TName extends CliEventName = CliEventName> = {
  name: TName;
  payload: CliEventPayload<TName>;
};

export type CliEventContext<
  TName extends CliEventName = CliEventName,
  TOptions extends Options = Options,
  TParams extends object = Params,
  TValues extends object = EmptyObject,
> = Context<TOptions, TParams, TValues> & {
  event: CliEventRecord<TName>;
} & (TName extends "error" ? { error: unknown } : EmptyObject) &
  (TName extends "notFound" ? { argv: readonly string[] } : EmptyObject) &
  (TName extends "help" ? { document: HelpDocument } : EmptyObject);

export type CliEventHandler<
  TName extends CliEventName = CliEventName,
  TOptions extends Options = Options,
  TValues extends object = EmptyObject,
> = (ctx: CliEventContext<TName, TOptions, Params, TValues>) => Awaitable<ActionResult>;
