export type ExitResult<TValue = unknown> = {
  readonly kind: "duru.exit";
  ok: boolean;
  exitCode: number;
  result: TValue;
};

export type ValidationErrorSource = "params" | "options" | "input";

export type ValidationIssue = {
  path: readonly string[];
  code: string;
  message: string;
  expected?: string;
  received?: unknown;
};

export type ValidationErrorResult = {
  readonly kind: "duru.validation_error";
  source: ValidationErrorSource;
  issues: readonly ValidationIssue[];
};
