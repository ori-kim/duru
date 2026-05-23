import type { ExitResult, ValidationErrorResult, ValidationErrorSource, ValidationIssue } from "../types/index.ts";

export function exit<TValue>(exitCode: number, result: TValue, ok = exitCode === 0): ExitResult<TValue> {
  return { kind: "duru.exit", ok, exitCode, result };
}

export function isExitResult(value: unknown): value is ExitResult {
  return isRecord(value) && value.kind === "duru.exit" && typeof value.exitCode === "number";
}

export function validationError(
  source: ValidationErrorSource,
  issues: readonly ValidationIssue[],
): ValidationErrorResult {
  return { kind: "duru.validation_error", source, issues };
}

export function isValidationError(value: unknown): value is ValidationErrorResult {
  return isRecord(value) && value.kind === "duru.validation_error" && Array.isArray(value.issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
