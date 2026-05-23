import { input as coreInput, parseOptionSpec, validationError } from "@duru/cli-kit";
import type { CommandFeature, EmptyObject, OptionDefinition, ParamDefinition, ValidationIssue } from "@duru/cli-kit";

type StandardSchema<TInput = unknown, TOutput = TInput> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
    readonly types?: {
      readonly input: TInput;
      readonly output: TOutput;
    };
  };
};

type StandardResult<TOutput> =
  | {
      readonly value: TOutput;
      readonly issues?: undefined;
    }
  | {
      readonly issues: readonly StandardIssue[];
    };

type StandardIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { key: PropertyKey })[];
};

type AnySchema = StandardSchema<unknown, unknown>;
type FieldKind = "param" | "option" | "flag";
type Group = AnySchema | FieldMap | undefined;
type FieldMap = Record<string, FieldInput>;
type FieldInput = AnySchema | FieldDefinition<AnySchema>;

type GroupOutput<TGroup> = TGroup extends StandardSchema<unknown, infer TOutput>
  ? ObjectOutput<TOutput>
  : TGroup extends FieldMap
    ? { [K in keyof TGroup]: FieldOutput<TGroup[K]> }
    : EmptyObject;

type ObjectOutput<TValue> = TValue extends object ? TValue : EmptyObject;

type FieldOutput<TField> = TField extends FieldDefinition<infer TSchema>
  ? SchemaOutput<TSchema>
  : TField extends StandardSchema<unknown, infer TOutput>
    ? TOutput
    : unknown;

type SchemaOutput<TSchema> = TSchema extends StandardSchema<unknown, infer TOutput> ? TOutput : unknown;

export type InputSchema<TParams extends Group = undefined, TOptions extends Group = undefined> = {
  params?: TParams;
  options?: TOptions;
};

export type FieldOptions = {
  description?: string;
  required?: boolean;
};

export type FieldDefinition<TSchema extends AnySchema = AnySchema> = FieldOptions & {
  schema: TSchema;
  kind?: FieldKind;
};

export function param<TSchema extends AnySchema>(
  schema: TSchema,
  options: FieldOptions = {},
): FieldDefinition<TSchema> {
  return { ...options, schema, kind: "param" };
}

export function option<TSchema extends AnySchema>(
  schema: TSchema,
  options: FieldOptions = {},
): FieldDefinition<TSchema> {
  return { ...options, schema, kind: "option" };
}

export function flag<TSchema extends AnySchema>(schema: TSchema, options: FieldOptions = {}): FieldDefinition<TSchema> {
  return { ...options, schema, kind: "flag" };
}

export function input<TParams extends Group = undefined, TOptions extends Group = undefined>(
  schema: InputSchema<TParams, TOptions>,
): CommandFeature<GroupOutput<TParams>, GroupOutput<TOptions>> {
  const params = group(schema.params);
  const options = group(schema.options);

  return coreInput({
    params: paramDefinitions(params),
    options: optionDefinitions(options),
    async parse(raw) {
      const parsedParams = await parseGroup(params, raw.params);
      const parsedOptions = await parseGroup(options, raw.options);
      const issues = [...parsedParams.issues, ...parsedOptions.issues];
      if (issues.length > 0) throw validationError("input", issues);

      return {
        params: parsedParams.value as GroupOutput<TParams>,
        options: parsedOptions.value as GroupOutput<TOptions>,
      };
    },
  });
}

async function parseGroup(group: NormalizedGroup, value: unknown): Promise<ValidationResult> {
  if (group.schema) return validateSchema(group.schema, value);

  const output: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  for (const [name, field] of group.fields) {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const result = await validateSchemaResult(field.schema, record[name]);
    if ("issues" in result && result.issues) {
      issues.push(...validationIssues(name, result.issues));
    } else {
      output[name] = result.value;
    }
  }
  return { value: output, issues };
}

async function validateSchema(schema: AnySchema, value: unknown): Promise<ValidationResult> {
  const result = await validateSchemaResult(schema, value);
  if ("issues" in result && result.issues) return { value: {}, issues: validationIssues(undefined, result.issues) };
  return { value: result.value && typeof result.value === "object" ? result.value : {}, issues: [] };
}

function validateSchemaResult(
  schema: AnySchema,
  value: unknown,
): Promise<StandardResult<unknown>> | StandardResult<unknown> {
  return schema["~standard"].validate(value);
}

type ValidationResult = {
  value: object;
  issues: ValidationIssue[];
};

type NormalizedField = FieldOptions & {
  name: string;
  kind?: FieldKind;
  schema: AnySchema;
};

type NormalizedGroup = {
  schema?: AnySchema;
  fields: Array<[string, NormalizedField]>;
};

function group(value: Group): NormalizedGroup {
  if (!value) return { fields: [] };
  if (isStandardSchema(value)) {
    const shape = objectShape(value);
    return {
      schema: value,
      fields: shape ? fieldEntries(shape) : [],
    };
  }
  return { fields: fieldEntries(value) };
}

function fieldEntries(map: FieldMap): Array<[string, NormalizedField]> {
  return Object.entries(map).map(([name, value]) => {
    assertCliShapeKey(name);
    const field = isFieldDefinition(value) ? { ...value, name } : { name, schema: value };
    if (!isStandardSchema(field.schema)) {
      throw new Error(`Invalid validation schema for ${name}: expected a Standard Schema compatible schema.`);
    }
    return [name, field];
  });
}

function paramDefinitions(group: NormalizedGroup): ParamDefinition[] {
  const definitions = group.fields.map(([name, field]) => ({
    name,
    required: field.required ?? !isOptionalInput(field.schema),
    ...((field.description ?? schemaDescription(field.schema))
      ? { description: field.description ?? schemaDescription(field.schema) }
      : {}),
  }));
  assertParamOrder(definitions);
  return definitions;
}

function optionDefinitions(group: NormalizedGroup): OptionDefinition[] {
  const definitions = group.fields.map(([name, field]) => {
    const isFlag = field.kind === "flag" || (field.kind !== "option" && isBooleanSchema(field.schema));
    const spec = isFlag ? `--${kebabCase(name)}` : `--${kebabCase(name)} <value>`;
    return parseOptionSpec(spec, field.description ?? schemaDescription(field.schema));
  });
  assertUniqueOptionAliases(definitions);
  return definitions;
}

function validationIssues(prefix: string | undefined, issues: readonly StandardIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: [...(prefix ? [prefix] : []), ...issuePath(issue)],
    code: "invalid_value",
    message: issue.message,
  }));
}

function issuePath(issue: StandardIssue): string[] {
  return (issue.path ?? []).map((segment) =>
    String(typeof segment === "object" && segment !== null ? segment.key : segment),
  );
}

function isFieldDefinition(value: FieldInput): value is FieldDefinition<AnySchema> {
  return typeof value === "object" && value !== null && "schema" in value;
}

function isStandardSchema(value: unknown): value is AnySchema {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { "~standard"?: { validate?: unknown } })["~standard"]?.validate === "function"
  );
}

function objectShape(schema: AnySchema): FieldMap | undefined {
  const value = schema as { shape?: unknown };
  if (value.shape && typeof value.shape === "object") return value.shape as FieldMap;
  return undefined;
}

function schemaDescription(schema: AnySchema): string | undefined {
  const description = (schema as { description?: unknown }).description;
  return typeof description === "string" ? description : undefined;
}

function isBooleanSchema(schema: AnySchema): boolean {
  const base = unwrapSchema(schema);
  const definition = schemaDefinition(base);
  return definition.type === "boolean" || definition.typeName === "ZodBoolean";
}

function isOptionalInput(schema: AnySchema): boolean {
  const definition = schemaDefinition(schema);
  if (isOptionalDefinition(definition)) return true;
  if (definition.type === "pipe" || definition.typeName === "ZodPipeline") {
    return Boolean(
      definition.in && isOptionalInput(definition.in) && definition.out && isOptionalInput(definition.out),
    );
  }
  if (definition.type === "transform" || definition.typeName === "ZodTransform") return true;
  return false;
}

function isOptionalDefinition(definition: SchemaDefinition): boolean {
  return (
    definition.type === "optional" ||
    definition.type === "default" ||
    definition.type === "prefault" ||
    definition.type === "catch" ||
    definition.typeName === "ZodOptional" ||
    definition.typeName === "ZodDefault" ||
    definition.typeName === "ZodCatch"
  );
}

function unwrapSchema(schema: AnySchema): AnySchema {
  let current = schema;
  for (;;) {
    const next = innerSchema(current);
    if (!next || next === current) return current;
    current = next;
  }
}

function innerSchema(schema: AnySchema): AnySchema | undefined {
  const definition = schemaDefinition(schema);
  return definition.in ?? definition.innerType ?? definition.schema;
}

type SchemaDefinition = {
  in?: AnySchema;
  innerType?: AnySchema;
  out?: AnySchema;
  schema?: AnySchema;
  type?: string;
  typeName?: string;
};

function schemaDefinition(schema: AnySchema): SchemaDefinition {
  const definition = (schema as { _def?: unknown })._def;
  return typeof definition === "object" && definition !== null ? (definition as SchemaDefinition) : {};
}

function assertParamOrder(definitions: readonly ParamDefinition[]): void {
  let hasOptional = false;
  for (const definition of definitions) {
    if (definition.required === false) hasOptional = true;
    if (hasOptional && definition.required !== false) {
      throw new Error(`Required params cannot follow optional params: ${definition.name}`);
    }
  }
}

function assertUniqueOptionAliases(definitions: readonly OptionDefinition[]): void {
  const aliases = new Set<string>();
  for (const definition of definitions) {
    for (const alias of definition.aliases) {
      if (aliases.has(alias)) throw new Error(`Duplicate command option alias: ${alias}`);
      aliases.add(alias);
    }
  }
}

function assertCliShapeKey(name: string): void {
  if (name === "" || /[\s<>\[\]]/.test(name)) {
    throw new Error(
      `Invalid validation input key: ${JSON.stringify(name)}. Keys must be non-empty and cannot contain whitespace, <, >, [, or ].`,
    );
  }
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}
