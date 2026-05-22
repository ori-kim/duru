import type { Awaitable, EmptyObject } from "./common.ts";
import type { CommandMetadata } from "./help.ts";
import type { OptionDefinition, RawOptions } from "./options.ts";
import type { RawParams } from "./pattern.ts";

export type ParamDefinition = {
  name: string;
  required?: boolean;
  variadic?: boolean;
  description?: string;
};

export type CommandInputRaw = {
  readonly argv: readonly string[];
  readonly pattern: string;
  readonly params: RawParams;
  readonly options: RawOptions;
  readonly positionals: readonly string[];
};

export type CommandInputResult<TParams extends object = EmptyObject, TOptions extends object = EmptyObject> = {
  params?: TParams;
  options?: TOptions;
};

export type CommandInputDefinition<TParams extends object = EmptyObject, TOptions extends object = EmptyObject> = {
  params?: readonly ParamDefinition[];
  options?: readonly OptionDefinition[];
  metadata?: CommandMetadata;
  parse(input: CommandInputRaw): Awaitable<CommandInputResult<TParams, TOptions>>;
};

export type CommandFeature<TParams extends object = EmptyObject, TOptions extends object = EmptyObject> = {
  kind: "commandInput";
  definition: CommandInputDefinition<TParams, TOptions>;
  metadata?: CommandMetadata;
};
