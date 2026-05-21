import type { ExitResult } from "../types/index.ts";

export function exit<TValue>(exitCode: number, result: TValue, ok = exitCode === 0): ExitResult<TValue> {
  return { kind: "clip.exit", ok, exitCode, result };
}

export function isExitResult(value: unknown): value is ExitResult {
  return isRecord(value) && value.kind === "clip.exit" && typeof value.exitCode === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
