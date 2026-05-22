import { input, parseOptionSpec, validationError } from "@clip/core";
import type { CommandFeature, EmptyObject, OptionDefinition, ParamDefinition, ValidationIssue } from "@clip/core";
import * as zod from "zod";

type ZodShape = zod.ZodRawShape;
type ZodObject = zod.ZodObject<ZodShape>;
type ZodGroup = ZodShape | ZodObject;
type AnyZodSchema = zod.ZodType;

type GroupOutput<TGroup> = TGroup extends ZodObject
  ? zod.output<TGroup>
  : TGroup extends ZodShape
    ? zod.output<zod.ZodObject<TGroup>>
    : EmptyObject;

export type ZodCommandInput<TParams extends ZodGroup | undefined, TOptions extends ZodGroup | undefined> = {
  params?: TParams;
  options?: TOptions;
};

function commandInput<
  TParams extends ZodGroup | undefined = undefined,
  TOptions extends ZodGroup | undefined = undefined,
>(schema: ZodCommandInput<TParams, TOptions>): CommandFeature<GroupOutput<TParams>, GroupOutput<TOptions>> {
  const paramsSchema = objectSchema(schema.params);
  const optionsSchema = objectSchema(schema.options);

  return input({
    params: paramDefinitions(schema.params),
    options: optionDefinitions(schema.options),
    parse(raw) {
      const params = paramsSchema.safeParse(raw.params);
      const options = optionsSchema.safeParse(raw.options);
      const issues = [...validationIssues(params), ...validationIssues(options)];
      if (issues.length > 0) throw validationError("input", issues);

      return {
        params: params.data as GroupOutput<TParams>,
        options: options.data as GroupOutput<TOptions>,
      };
    },
  });
}

export const zodInput = commandInput;
export const z = zodNamespace();

function zodNamespace(): typeof commandInput & typeof zod {
  const namespace = commandInput as typeof commandInput & typeof zod;
  for (const key of Object.keys(zod) as Array<keyof typeof zod>) {
    if (Object.prototype.hasOwnProperty.call(namespace, key)) continue;
    Object.defineProperty(namespace, key, {
      value: zod[key],
      enumerable: true,
      configurable: true,
    });
  }
  return namespace;
}

function paramDefinitions(group: ZodGroup | undefined): ParamDefinition[] {
  const definitions = schemaEntries(group).map(([name, schema]) => {
    assertCliShapeKey("param", name);
    return {
      name,
      required: !isOptionalInput(schema),
      ...(schema.description ? { description: schema.description } : {}),
    };
  });
  assertParamOrder(definitions);
  return definitions;
}

function optionDefinitions(group: ZodGroup | undefined): OptionDefinition[] {
  const definitions = schemaEntries(group).map(([name, schema]) => {
    assertCliShapeKey("option", name);
    const spec = isBooleanSchema(schema) ? `--${kebabCase(name)}` : `--${kebabCase(name)} <value>`;
    return parseOptionSpec(spec, schema.description);
  });
  assertUniqueOptionAliases(definitions);
  return definitions;
}

function objectSchema(group: ZodGroup | undefined): ZodObject {
  if (!group) return zod.object({});
  if (isZodObject(group)) return group;
  return zod.object(group);
}

function schemaEntries(group: ZodGroup | undefined): Array<[string, AnyZodSchema]> {
  if (!group) return [];
  const shape = isZodObject(group) ? objectShape(group) : group;
  return Object.entries(shape) as Array<[string, AnyZodSchema]>;
}

function isZodObject(value: ZodGroup): value is ZodObject {
  return value instanceof zod.ZodObject;
}

function objectShape(schema: ZodObject): ZodShape {
  return schema.shape;
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

function assertCliShapeKey(kind: "param" | "option", name: string): void {
  if (name === "" || /[\s<>\[\]]/.test(name)) {
    throw new Error(
      `Invalid Zod ${kind} key: ${JSON.stringify(name)}. Keys must be non-empty and cannot contain whitespace, <, >, [, or ].`,
    );
  }
}

function validationIssues(result: zod.ZodSafeParseResult<unknown>): ValidationIssue[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(String),
    code: issue.code,
    message: issue.message,
    ...("expected" in issue && typeof issue.expected === "string" ? { expected: issue.expected } : {}),
    ...("received" in issue ? { received: issue.received } : {}),
  }));
}

function isBooleanSchema(schema: AnyZodSchema): boolean {
  const base = unwrapSchema(schema);
  const definition = base._def as { type?: string; typeName?: string };
  return definition.type === "boolean" || definition.typeName === "ZodBoolean";
}

function isOptionalInput(schema: AnyZodSchema): boolean {
  const definition = schema._def as {
    in?: AnyZodSchema;
    innerType?: AnyZodSchema;
    out?: AnyZodSchema;
    type?: string;
    typeName?: string;
  };
  if (isOptionalDefinition(definition)) return true;
  if (definition.type === "pipe" || definition.typeName === "ZodPipeline") {
    return Boolean(
      definition.in && isOptionalInput(definition.in) && definition.out && isOptionalInput(definition.out),
    );
  }
  if (definition.type === "transform" || definition.typeName === "ZodTransform") return true;
  return false;
}

function isOptionalDefinition(definition: { type?: string; typeName?: string }): boolean {
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

function unwrapSchema(schema: AnyZodSchema): AnyZodSchema {
  let current = schema;
  for (;;) {
    const next = innerSchema(current);
    if (!next || next === current) return current;
    current = next;
  }
}

function innerSchema(schema: AnyZodSchema): AnyZodSchema | undefined {
  const definition = schema._def as {
    in?: AnyZodSchema;
    innerType?: AnyZodSchema;
    schema?: AnyZodSchema;
    type?: string;
    typeName?: string;
  };
  return definition.in ?? definition.innerType ?? definition.schema;
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}
