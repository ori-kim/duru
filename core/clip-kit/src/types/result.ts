export type ExitResult<TValue = unknown> = {
  readonly kind: "clip.exit";
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
  readonly kind: "clip.validation_error";
  source: ValidationErrorSource;
  issues: readonly ValidationIssue[];
};
