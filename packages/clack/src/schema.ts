export type StandardSchemaV1<TInput = unknown, TOutput = TInput> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
    readonly types?: { readonly input: TInput; readonly output: TOutput };
  };
};

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };

export type StandardIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { key: PropertyKey })[];
};

export type ValidatorFn<TValue> = (value: TValue) => string | Error | undefined;

export function fromSchema<TInput>(
  schema: StandardSchemaV1<TInput>,
): ValidatorFn<TInput | undefined> {
  return (value) => {
    const result = schema["~standard"].validate(value);
    if (result instanceof Promise) {
      return new Error("Async schema validation is not supported in clack prompts.");
    }
    if (result.issues && result.issues.length > 0) {
      return result.issues[0]?.message ?? "Validation failed";
    }
    return undefined;
  };
}

export function composeValidator<TValue>(
  schema: StandardSchemaV1<TValue> | undefined,
  validate: ValidatorFn<TValue | undefined> | undefined,
): ValidatorFn<TValue | undefined> | undefined {
  if (!schema && !validate) return undefined;
  if (!schema) return validate;
  const schemaValidate = fromSchema(schema);
  if (!validate) return schemaValidate;
  return (value) => schemaValidate(value) ?? validate(value);
}
