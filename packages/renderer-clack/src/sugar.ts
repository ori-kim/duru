import { withRenderHint } from "@duru/cli-kit";

export type TextSugar = { text: string };
export type NoteSugar = { body: string; title?: string };
export type TableSugar = { rows: readonly Record<string, unknown>[]; columns?: readonly string[] };
export type ListSugar = { items: readonly unknown[] };
export type ErrorSugar = { message: string; exitCode?: number };
export type SpinnerSugar = { label: string; phase: "start" | "stop" | "fail"; message?: string };
export type ProgressSugar = { value: number; total?: number; label?: string };
export type LogSugar = { text: string; level: "info" | "success" | "warn" | "error" | "step" };

export function text(value: string): TextSugar {
  return withRenderHint({ text: value }, "text");
}

export function note(body: string, title?: string): NoteSugar {
  return withRenderHint(title ? { body, title } : { body }, "note");
}

export function table(rows: readonly Record<string, unknown>[], columns?: readonly string[]): TableSugar {
  return withRenderHint(columns ? { rows, columns } : { rows }, "table");
}

export function list(items: readonly unknown[]): ListSugar {
  return withRenderHint({ items }, "list");
}

export function error(message: string, exitCode = 1): ErrorSugar {
  return withRenderHint({ message, exitCode }, "error");
}

export function spinner(label: string, phase: SpinnerSugar["phase"] = "start", message?: string): SpinnerSugar {
  return withRenderHint(message ? { label, phase, message } : { label, phase }, "spinner");
}

export function progress(value: number, total?: number, label?: string): ProgressSugar {
  const payload: ProgressSugar = { value };
  if (total !== undefined) payload.total = total;
  if (label !== undefined) payload.label = label;
  return withRenderHint(payload, "progress");
}

export function log(text: string, level: LogSugar["level"] = "info"): LogSugar {
  return withRenderHint({ text, level }, "log");
}
