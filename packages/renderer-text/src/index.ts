import { applyFieldFilter, createPlugin, getRenderHint, parseFilterFields } from "@duru/cli-kit";
import type { CliPlugin, Renderer } from "@duru/cli-kit";

export function textRenderer(): Renderer {
  return {
    id: "text",
    render(input, ctx) {
      const fields = parseFilterFields((ctx.options as { outputFilter?: unknown }).outputFilter);
      const value = applyFieldFilter(input.value, fields);
      const hint = getRenderHint(value);

      if (hint === "error" && isRecord(value)) {
        const message = typeof value.message === "string" ? value.message : String(value);
        const exitCode = typeof value.exitCode === "number" ? value.exitCode : 1;
        return { stdout: "", stderr: line(message), exitCode };
      }

      if (hint === "table" && isRecord(value) && Array.isArray(value.rows)) {
        return { stdout: formatTable(value.rows as readonly unknown[]), stderr: "", exitCode: 0 };
      }

      if (hint === "list" && isRecord(value) && Array.isArray(value.items)) {
        return { stdout: formatList(value.items as readonly unknown[]), stderr: "", exitCode: 0 };
      }

      if (hint === "text" && isRecord(value) && typeof value.text === "string") {
        return { stdout: line(value.text), stderr: "", exitCode: 0 };
      }

      return { stdout: formatText(value), stderr: "", exitCode: 0 };
    },
  };
}

export function textRendererPlugin(): CliPlugin {
  return createPlugin((api) => {
    api.renderer(textRenderer());
    api.defaultRenderer("text");
  });
}

function formatText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return line(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return line(String(value));
  }
  if (Array.isArray(value) && value.every(isRecord)) return formatTable(value);
  if (Array.isArray(value)) return formatList(value);
  return line(JSON.stringify(value));
}

function formatTable(rows: readonly unknown[]): string {
  if (rows.length === 0) return "";
  const records = rows.filter(isRecord);
  if (records.length === 0) return formatList(rows);
  const columns = Array.from(new Set(records.flatMap((row) => Object.keys(row))));
  const cells = records.map((row) => columns.map((col) => formatCell(row[col])));
  const widths = columns.map((col, i) =>
    Math.max(visibleWidth(col), ...cells.map((row) => visibleWidth(row[i] ?? ""))),
  );
  const header = padRow(columns, widths);
  const body = cells.map((row) => padRow(row, widths)).join("\n");
  return `${header}\n${body}\n`;
}

function formatList(items: readonly unknown[]): string {
  if (items.length === 0) return "";
  return `${items.map((item) => formatCell(item)).join("\n")}\n`;
}

function padRow(row: readonly string[], widths: readonly number[]): string {
  return row
    .map((cell, i) => (i === row.length - 1 ? cell : padEnd(cell, widths[i] ?? 0)))
    .join("  ");
}

function padEnd(cell: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(cell));
  return pad === 0 ? cell : cell + " ".repeat(pad);
}

function visibleWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && isWide(cp)) width += 2;
    else width += 1;
  }
  return width;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function line(value: string | undefined): string {
  return value ? `${value}\n` : "";
}
