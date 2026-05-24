import * as p from "@clack/prompts";
import { composeValidator } from "./schema.ts";
import type { StandardSchemaV1, ValidatorFn } from "./schema.ts";

export type SelectOption<T> = {
  value: T;
  label?: string;
  hint?: string;
  disabled?: boolean;
};

export class ClackCancelError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ClackCancelError";
  }
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new ClackCancelError();
  return value as T;
}

export type TextOptions = {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
};

export async function text(opts: TextOptions): Promise<string> {
  return unwrap(
    await p.text({
      message: opts.message,
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      initialValue: opts.initialValue,
      validate: composeValidator(opts.schema, opts.validate),
    }),
  );
}

export type MultilineOptions = TextOptions & { showSubmit?: boolean };

export async function multiline(opts: MultilineOptions): Promise<string> {
  return unwrap(
    await p.multiline({
      message: opts.message,
      placeholder: opts.placeholder,
      defaultValue: opts.defaultValue,
      initialValue: opts.initialValue,
      validate: composeValidator(opts.schema, opts.validate),
      showSubmit: opts.showSubmit,
    }),
  );
}

export type PasswordPromptOptions = {
  message: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
  mask?: string;
  clearOnError?: boolean;
};

export async function password(opts: PasswordPromptOptions): Promise<string> {
  return unwrap(
    await p.password({
      message: opts.message,
      validate: composeValidator(opts.schema, opts.validate),
      mask: opts.mask,
      clearOnError: opts.clearOnError,
    }),
  );
}

export type SelectPromptOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
  maxItems?: number;
};

export async function select<T>(opts: SelectPromptOptions<T>): Promise<T> {
  return unwrap(
    await p.select<T>({
      message: opts.message,
      options: opts.options as Parameters<typeof p.select<T>>[0]["options"],
      initialValue: opts.initialValue,
      maxItems: opts.maxItems,
    }),
  );
}

export type SelectKeyPromptOptions<T extends string> = {
  message: string;
  options: SelectOption<T>[];
  initialValue?: T;
  caseSensitive?: boolean;
};

export async function selectKey<T extends string>(opts: SelectKeyPromptOptions<T>): Promise<T> {
  return unwrap(
    await p.selectKey<T>({
      message: opts.message,
      options: opts.options as Parameters<typeof p.selectKey<T>>[0]["options"],
      initialValue: opts.initialValue,
      caseSensitive: opts.caseSensitive,
    }),
  );
}

export type CheckboxOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  required?: boolean;
  initialValues?: T[];
  cursorAt?: T;
  maxItems?: number;
};

export async function checkbox<T>(opts: CheckboxOptions<T>): Promise<T[]> {
  return unwrap(
    await p.multiselect<T>({
      message: opts.message,
      options: opts.options as Parameters<typeof p.multiselect<T>>[0]["options"],
      required: opts.required,
      initialValues: opts.initialValues,
      cursorAt: opts.cursorAt,
      maxItems: opts.maxItems,
    }),
  );
}

export type AutocompletePromptOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  placeholder?: string;
  initialValue?: T;
  initialUserInput?: string;
  maxItems?: number;
  filter?: (search: string, option: SelectOption<T>) => boolean;
};

export async function autocomplete<T>(opts: AutocompletePromptOptions<T>): Promise<T> {
  return unwrap(
    await p.autocomplete<T>({
      message: opts.message,
      options: opts.options as Parameters<typeof p.autocomplete<T>>[0]["options"],
      placeholder: opts.placeholder,
      initialValue: opts.initialValue,
      initialUserInput: opts.initialUserInput,
      maxItems: opts.maxItems,
      filter: opts.filter as Parameters<typeof p.autocomplete<T>>[0]["filter"],
    }),
  );
}

export type AutocompleteCheckboxOptions<T> = {
  message: string;
  options: SelectOption<T>[];
  placeholder?: string;
  initialValues?: T[];
  required?: boolean;
  maxItems?: number;
  filter?: (search: string, option: SelectOption<T>) => boolean;
};

export async function autocompleteCheckbox<T>(opts: AutocompleteCheckboxOptions<T>): Promise<T[]> {
  return unwrap(
    await p.autocompleteMultiselect<T>({
      message: opts.message,
      options: opts.options as Parameters<typeof p.autocompleteMultiselect<T>>[0]["options"],
      placeholder: opts.placeholder,
      initialValues: opts.initialValues,
      required: opts.required,
      maxItems: opts.maxItems,
      filter: opts.filter as Parameters<typeof p.autocompleteMultiselect<T>>[0]["filter"],
    }),
  );
}

export type ConfirmPromptOptions = {
  message: string;
  initialValue?: boolean;
  active?: string;
  inactive?: string;
};

export async function confirm(opts: ConfirmPromptOptions): Promise<boolean> {
  return unwrap(
    await p.confirm({
      message: opts.message,
      initialValue: opts.initialValue,
      active: opts.active,
      inactive: opts.inactive,
    }),
  );
}

export type DatePromptOptions = {
  message: string;
  format?: p.DateOptions extends { format?: infer F } ? F : never;
  locale?: string;
  defaultValue?: Date;
  initialValue?: Date;
  minDate?: Date;
  maxDate?: Date;
  validate?: ValidatorFn<Date | undefined>;
  schema?: StandardSchemaV1<Date>;
};

export async function date(opts: DatePromptOptions): Promise<Date> {
  return unwrap(
    await p.date({
      message: opts.message,
      format: opts.format,
      locale: opts.locale,
      defaultValue: opts.defaultValue,
      initialValue: opts.initialValue,
      minDate: opts.minDate,
      maxDate: opts.maxDate,
      validate: composeValidator(opts.schema, opts.validate),
    }),
  );
}

export type PathPromptOptions = {
  message: string;
  root?: string;
  directory?: boolean;
  initialValue?: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
};

export async function path(opts: PathPromptOptions): Promise<string> {
  return unwrap(
    await p.path({
      message: opts.message,
      root: opts.root,
      directory: opts.directory,
      initialValue: opts.initialValue,
      validate: composeValidator(opts.schema, opts.validate),
    }),
  );
}

export type ClackInput = {
  text(opts: TextOptions): Promise<string>;
  multiline(opts: MultilineOptions): Promise<string>;
  password(opts: PasswordPromptOptions): Promise<string>;
  select<T>(opts: SelectPromptOptions<T>): Promise<T>;
  selectKey<T extends string>(opts: SelectKeyPromptOptions<T>): Promise<T>;
  checkbox<T>(opts: CheckboxOptions<T>): Promise<T[]>;
  autocomplete<T>(opts: AutocompletePromptOptions<T>): Promise<T>;
  autocompleteCheckbox<T>(opts: AutocompleteCheckboxOptions<T>): Promise<T[]>;
  confirm(opts: ConfirmPromptOptions): Promise<boolean>;
  date(opts: DatePromptOptions): Promise<Date>;
  path(opts: PathPromptOptions): Promise<string>;
};

export function createClackInput(): ClackInput {
  return {
    text,
    multiline,
    password,
    select,
    selectKey,
    checkbox,
    autocomplete,
    autocompleteCheckbox,
    confirm,
    date,
    path,
  };
}

export const CLACK_INPUT_SERVICE_KEY: unique symbol = Symbol("@duru/clack#input");

export type ClackInputContext = {
  service<T>(key: string | symbol): T | undefined;
};

export function useClack(ctx: ClackInputContext): ClackInput {
  const input = ctx.service<ClackInput>(CLACK_INPUT_SERVICE_KEY);
  if (!input) {
    throw new Error("useClack() requires clackPlugin() to be installed.");
  }
  return input;
}
