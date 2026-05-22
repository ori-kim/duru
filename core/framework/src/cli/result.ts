import { isExitResult, isValidationError } from "../result/index.ts";
import type { CliEventRecord, Context, RenderInput, RoutePresenter } from "../types/index.ts";

export type ExecutionResult = {
  ok: boolean;
  exitCode: number;
  result: unknown;
  presenters?: ReadonlyMap<string, RoutePresenter<unknown>>;
  ctx?: Context;
};

export function normalizeExecutionResult(result: ExecutionResult): ExecutionResult {
  if (!isExitResult(result.result)) return result;
  return {
    ...result,
    ok: result.result.ok,
    exitCode: result.result.exitCode,
    result: result.result.result,
  };
}

export function eventResult(value: unknown, fallback: ExecutionResult, ctx: Context): ExecutionResult {
  if (value === undefined) return fallback;
  if (isExitResult(value)) {
    return { ok: value.ok, exitCode: value.exitCode, result: value.result, ctx };
  }
  return { ok: fallback.ok, exitCode: fallback.exitCode, result: value, ctx };
}

export function defaultNotFoundResult(argv: readonly string[], ctx: Context): ExecutionResult {
  const message = `Unknown command: ${argv.join(" ")}`;
  return { ok: false, exitCode: 1, result: { message }, presenters: errorPresenters(message), ctx };
}

export function defaultErrorResult(error: unknown, ctx: Context): ExecutionResult {
  if (isValidationError(error)) {
    return { ok: false, exitCode: 2, result: error, presenters: validationPresenters(error), ctx };
  }
  const message = errorMessage(error);
  return { ok: false, exitCode: 1, result: { message }, presenters: errorPresenters(message), ctx };
}

export async function present(
  format: string | undefined,
  result: unknown,
  presenters: ReadonlyMap<string, RoutePresenter<unknown>> | undefined,
  ctx: Context,
): Promise<unknown> {
  if (!format) return result;
  const presenter = presenters?.get(format);
  return presenter ? presenter(result, ctx) : result;
}

export function renderInput(
  format: string,
  result: unknown,
  value: unknown,
  events: readonly CliEventRecord[],
): RenderInput {
  return { result, value, events, format };
}

function errorPresenters(message: string): ReadonlyMap<string, RoutePresenter<unknown>> {
  const presenters = new Map<string, RoutePresenter<unknown>>();
  presenters.set("text", () => message);
  presenters.set("json", () => ({ error: { message } }));
  return presenters;
}

function validationPresenters(error: unknown): ReadonlyMap<string, RoutePresenter<unknown>> {
  const presenters = new Map<string, RoutePresenter<unknown>>();
  presenters.set("text", () => "Validation failed");
  presenters.set("json", () => ({ error }));
  return presenters;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
