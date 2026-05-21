import type { ActionResult, Output, OutputWriter } from "../types/index.ts";

export function createOutputWriter(): OutputWriter {
  const outputs: Output[] = [];
  return {
    emit(output) {
      outputs.push(output);
    },
    text(text) {
      outputs.push({ kind: "text", text });
    },
    data(value) {
      outputs.push({ kind: "data", value });
    },
    table(rows) {
      outputs.push({ kind: "table", rows });
    },
    log(text, stream = "stdout") {
      outputs.push({ kind: "log", stream, text });
    },
    task(title, status, message) {
      outputs.push({ kind: "task", title, status, ...(message ? { message } : {}) });
    },
    view(value) {
      outputs.push({ kind: "view", value });
    },
    list() {
      return [...outputs];
    },
  };
}

export function normalizeActionResult(value: ActionResult): Output[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeActionResult(item));
  if (isOutput(value)) return [value];
  if (typeof value === "string") return [{ kind: "text", text: value }];
  if (typeof value === "number" || typeof value === "boolean") return [{ kind: "data", value }];
  return [{ kind: "data", value }];
}

function isOutput(value: unknown): value is Output {
  if (!isRecord(value)) return false;
  return (
    value.kind === "text" ||
    value.kind === "data" ||
    value.kind === "table" ||
    value.kind === "log" ||
    value.kind === "task" ||
    value.kind === "view"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
