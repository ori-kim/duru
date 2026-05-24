import { input as createInputFeature } from "@duru/cli-kit";
import type { CommandFeature, EmptyObject, OptionDefinition } from "@duru/cli-kit";
import * as prompt from "./prompt.ts";
import type { SelectOption } from "./prompt.ts";
import type { StandardSchemaV1, ValidatorFn } from "./schema.ts";

type EmptyParams = EmptyObject;

function optionDef(name: string, type: "value" | "boolean", description?: string): OptionDefinition {
  return { name, aliases: [`--${name}`], type, description };
}

export type TextFeatureOptions<Name extends string> = {
  name: Name;
  message: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
};

export function text<const Name extends string>(
  opts: TextFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: string }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string"
          ? existing
          : await prompt.text({
              message: opts.message,
              placeholder: opts.placeholder,
              defaultValue: opts.defaultValue,
              initialValue: opts.initialValue,
              validate: opts.validate,
              schema: opts.schema,
            });
      return { options: { [opts.name]: value } as { [K in Name]: string } };
    },
  });
}

export type MultilineFeatureOptions<Name extends string> = TextFeatureOptions<Name> & {
  showSubmit?: boolean;
};

export function multiline<const Name extends string>(
  opts: MultilineFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: string }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string"
          ? existing
          : await prompt.multiline({
              message: opts.message,
              placeholder: opts.placeholder,
              defaultValue: opts.defaultValue,
              initialValue: opts.initialValue,
              validate: opts.validate,
              schema: opts.schema,
              showSubmit: opts.showSubmit,
            });
      return { options: { [opts.name]: value } as { [K in Name]: string } };
    },
  });
}

export type PasswordFeatureOptions<Name extends string> = {
  name: Name;
  message: string;
  description?: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
};

export function password<const Name extends string>(
  opts: PasswordFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: string }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string"
          ? existing
          : await prompt.password({
              message: opts.message,
              validate: opts.validate,
              schema: opts.schema,
            });
      return { options: { [opts.name]: value } as { [K in Name]: string } };
    },
  });
}

export type SelectFeatureOptions<Name extends string, T extends string> = {
  name: Name;
  message: string;
  options: SelectOption<T>[];
  description?: string;
  initialValue?: T;
};

export function select<const Name extends string, const T extends string>(
  opts: SelectFeatureOptions<Name, T>,
): CommandFeature<EmptyParams, { [K in Name]: T }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string" && opts.options.some((o) => o.value === existing)
          ? (existing as T)
          : await prompt.select({
              message: opts.message,
              options: opts.options,
              initialValue: opts.initialValue,
            });
      return { options: { [opts.name]: value } as { [K in Name]: T } };
    },
  });
}

export type SelectKeyFeatureOptions<Name extends string, T extends string> = SelectFeatureOptions<Name, T> & {
  caseSensitive?: boolean;
};

export function selectKey<const Name extends string, const T extends string>(
  opts: SelectKeyFeatureOptions<Name, T>,
): CommandFeature<EmptyParams, { [K in Name]: T }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string" && opts.options.some((o) => o.value === existing)
          ? (existing as T)
          : await prompt.selectKey({
              message: opts.message,
              options: opts.options,
              initialValue: opts.initialValue,
              caseSensitive: opts.caseSensitive,
            });
      return { options: { [opts.name]: value } as { [K in Name]: T } };
    },
  });
}

export type AutocompleteFeatureOptions<Name extends string, T extends string> = SelectFeatureOptions<Name, T> & {
  placeholder?: string;
  maxItems?: number;
};

export function autocomplete<const Name extends string, const T extends string>(
  opts: AutocompleteFeatureOptions<Name, T>,
): CommandFeature<EmptyParams, { [K in Name]: T }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string" && opts.options.some((o) => o.value === existing)
          ? (existing as T)
          : await prompt.autocomplete({
              message: opts.message,
              options: opts.options,
              initialValue: opts.initialValue,
              placeholder: opts.placeholder,
              maxItems: opts.maxItems,
            });
      return { options: { [opts.name]: value } as { [K in Name]: T } };
    },
  });
}

export type CheckboxFeatureOptions<Name extends string, T extends string> = {
  name: Name;
  message: string;
  options: SelectOption<T>[];
  description?: string;
  required?: boolean;
  initialValues?: T[];
};

export function checkbox<const Name extends string, const T extends string>(
  opts: CheckboxFeatureOptions<Name, T>,
): CommandFeature<EmptyParams, { [K in Name]: T[] }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value = Array.isArray(existing)
        ? (existing.filter((v): v is T => typeof v === "string" && opts.options.some((o) => o.value === v)) as T[])
        : await prompt.checkbox({
            message: opts.message,
            options: opts.options,
            required: opts.required,
            initialValues: opts.initialValues,
          });
      return { options: { [opts.name]: value } as { [K in Name]: T[] } };
    },
  });
}

export type AutocompleteCheckboxFeatureOptions<Name extends string, T extends string> = CheckboxFeatureOptions<
  Name,
  T
> & {
  placeholder?: string;
  maxItems?: number;
};

export function autocompleteCheckbox<const Name extends string, const T extends string>(
  opts: AutocompleteCheckboxFeatureOptions<Name, T>,
): CommandFeature<EmptyParams, { [K in Name]: T[] }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value = Array.isArray(existing)
        ? (existing.filter((v): v is T => typeof v === "string" && opts.options.some((o) => o.value === v)) as T[])
        : await prompt.autocompleteCheckbox({
            message: opts.message,
            options: opts.options,
            required: opts.required,
            initialValues: opts.initialValues,
            placeholder: opts.placeholder,
            maxItems: opts.maxItems,
          });
      return { options: { [opts.name]: value } as { [K in Name]: T[] } };
    },
  });
}

export type ConfirmFeatureOptions<Name extends string> = {
  name: Name;
  message: string;
  description?: string;
  initialValue?: boolean;
};

export function confirm<const Name extends string>(
  opts: ConfirmFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: boolean }> {
  return createInputFeature({
    options: [optionDef(opts.name, "boolean", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      if (typeof existing === "boolean") {
        return { options: { [opts.name]: existing } as { [K in Name]: boolean } };
      }
      if (raw.options.yes === true) {
        return { options: { [opts.name]: opts.initialValue ?? true } as { [K in Name]: boolean } };
      }
      const value = await prompt.confirm({ message: opts.message, initialValue: opts.initialValue });
      return { options: { [opts.name]: value } as { [K in Name]: boolean } };
    },
  });
}

export type DateFeatureOptions<Name extends string> = {
  name: Name;
  message: string;
  description?: string;
  defaultValue?: Date;
  initialValue?: Date;
  minDate?: Date;
  maxDate?: Date;
  validate?: ValidatorFn<Date | undefined>;
  schema?: StandardSchemaV1<Date>;
};

export function date<const Name extends string>(
  opts: DateFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: Date }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      let value: Date;
      if (typeof existing === "string") {
        const parsed = new Date(existing);
        value = Number.isNaN(parsed.valueOf())
          ? await prompt.date({ message: opts.message, ...sanitizedDateOpts(opts) })
          : parsed;
      } else {
        value = await prompt.date({ message: opts.message, ...sanitizedDateOpts(opts) });
      }
      return { options: { [opts.name]: value } as { [K in Name]: Date } };
    },
  });
}

function sanitizedDateOpts<Name extends string>(opts: DateFeatureOptions<Name>): Omit<prompt.DatePromptOptions, "message"> {
  return {
    defaultValue: opts.defaultValue,
    initialValue: opts.initialValue,
    minDate: opts.minDate,
    maxDate: opts.maxDate,
    validate: opts.validate,
    schema: opts.schema,
  };
}

export type PathFeatureOptions<Name extends string> = {
  name: Name;
  message: string;
  description?: string;
  root?: string;
  directory?: boolean;
  initialValue?: string;
  validate?: ValidatorFn<string | undefined>;
  schema?: StandardSchemaV1<string>;
};

export function path<const Name extends string>(
  opts: PathFeatureOptions<Name>,
): CommandFeature<EmptyParams, { [K in Name]: string }> {
  return createInputFeature({
    options: [optionDef(opts.name, "value", opts.description)],
    async parse(raw) {
      const existing = raw.options[opts.name];
      const value =
        typeof existing === "string"
          ? existing
          : await prompt.path({
              message: opts.message,
              root: opts.root,
              directory: opts.directory,
              initialValue: opts.initialValue,
              validate: opts.validate,
              schema: opts.schema,
            });
      return { options: { [opts.name]: value } as { [K in Name]: string } };
    },
  });
}
