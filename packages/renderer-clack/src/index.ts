import * as p from "@clack/prompts";
import { createPlugin, getRenderHint } from "@duru/cli-kit";
import type { CliPlugin, Renderer, RendererContext, RenderInput, RenderedOutput } from "@duru/cli-kit";
import pc from "picocolors";

export * from "./sugar.ts";

type Spinner = ReturnType<typeof p.spinner>;

export function clackRenderer(): Renderer {
  const spinners = new Map<string, Spinner>();

  return {
    id: "clack",

    stream(value, ctx) {
      if (!ctx.io.isTTY) return;
      writeStream(value, spinners);
    },

    render(input, ctx) {
      return renderFinal(input, ctx, spinners);
    },
  };
}

export function clackRendererPlugin(): CliPlugin {
  return createPlugin((api) => {
    api.renderer(clackRenderer());
    api.defaultRenderer("clack");
  });
}

function writeStream(value: unknown, spinners: Map<string, Spinner>): void {
  const hint = getRenderHint(value);

  if (hint === "spinner" && isRecord(value)) {
    const label = String(value.label ?? "");
    const phase = (value.phase ?? "start") as "start" | "stop" | "fail";
    const message = typeof value.message === "string" ? value.message : undefined;
    if (phase === "start") {
      const s = p.spinner();
      s.start(label);
      spinners.set(label, s);
    } else if (phase === "stop") {
      spinners.get(label)?.stop(message ?? label);
      spinners.delete(label);
    } else {
      spinners.get(label)?.error(message ?? label);
      spinners.delete(label);
    }
    return;
  }

  if (hint === "log" && isRecord(value)) {
    const text = String(value.text ?? "");
    const level = (value.level ?? "info") as "info" | "success" | "warn" | "error" | "step";
    p.log[level](text);
    return;
  }

  if (hint === "progress" && isRecord(value)) {
    const v = Number(value.value ?? 0);
    const total = typeof value.total === "number" ? value.total : undefined;
    const label = typeof value.label === "string" ? value.label : "";
    const text = total ? `${label} ${v}/${total}` : `${label} ${v}`;
    p.log.step(text.trim());
    return;
  }

  if (hint === "note" && isRecord(value)) {
    p.note(String(value.body ?? ""), typeof value.title === "string" ? value.title : undefined);
    return;
  }

  if (hint === "text" && isRecord(value)) {
    p.log.info(String(value.text ?? ""));
    return;
  }

  if (typeof value === "string") {
    p.log.info(value);
    return;
  }

  if (value !== undefined && value !== null) {
    p.log.message(JSON.stringify(value));
  }
}

function renderFinal(input: RenderInput, ctx: RendererContext, spinners: Map<string, Spinner>): RenderedOutput {
  for (const [label, s] of spinners) {
    s.stop(label);
  }
  spinners.clear();

  const value = input.value;
  if (!ctx.io.isTTY) {
    return { stdout: fallbackText(value), stderr: "", exitCode: 0 };
  }

  const hint = getRenderHint(value);

  if (hint === "error" && isRecord(value)) {
    const message = String(value.message ?? "");
    const exitCode = typeof value.exitCode === "number" ? value.exitCode : 1;
    p.log.error(message);
    return { stdout: "", stderr: "", exitCode };
  }

  if (hint === "text" && isRecord(value) && typeof value.text === "string") {
    p.log.success(value.text);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (hint === "note" && isRecord(value)) {
    p.note(String(value.body ?? ""), typeof value.title === "string" ? value.title : undefined);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (hint === "table" && isRecord(value) && Array.isArray(value.rows)) {
    const columns = Array.isArray(value.columns) ? (value.columns as readonly string[]) : undefined;
    p.note(renderTable(value.rows as readonly Record<string, unknown>[], columns));
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (hint === "list" && isRecord(value) && Array.isArray(value.items)) {
    for (const item of value.items) p.log.step(formatCell(item));
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (value === undefined || value === null) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (typeof value === "string") {
    p.log.success(value);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (Array.isArray(value) && value.every(isRecord)) {
    p.note(renderTable(value as readonly Record<string, unknown>[]));
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (Array.isArray(value)) {
    for (const item of value) p.log.step(formatCell(item));
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (isRecord(value)) {
    p.note(JSON.stringify(value, null, 2));
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  p.log.message(String(value));
  return { stdout: "", stderr: "", exitCode: 0 };
}

function renderTable(rows: readonly Record<string, unknown>[], columns?: readonly string[]): string {
  if (rows.length === 0) return pc.dim("(empty)");
  const cols = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const widths = cols.map((col) => Math.max(col.length, ...rows.map((row) => formatCell(row[col]).length)));
  const header = cols.map((col, i) => pc.bold(col.padEnd(widths[i] ?? 0))).join("  ");
  const sep = cols.map((_, i) => pc.dim("─".repeat(widths[i] ?? 0))).join("  ");
  const body = rows
    .map((row) => cols.map((col, i) => formatCell(row[col]).padEnd(widths[i] ?? 0)).join("  "))
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function fallbackText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return `${value}\n`;
  if (isRecord(value)) {
    const hint = getRenderHint(value);
    if (hint === "text" && typeof value.text === "string") return `${value.text}\n`;
    if (hint === "error" && typeof value.message === "string") return `${value.message}\n`;
  }
  return `${JSON.stringify(value)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
