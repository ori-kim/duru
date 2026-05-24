import { createPlugin, getRenderHint } from "@duru/cli-kit";
import type { CliPlugin, Renderer } from "@duru/cli-kit";

export function textRenderer(): Renderer {
  return {
    id: "text",
    render(input) {
      const value = input.value;
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
  const header = columns.join("\t");
  const body = records.map((row) => columns.map((col) => formatCell(row[col])).join("\t")).join("\n");
  return `${header}\n${body}\n`;
}

function formatList(items: readonly unknown[]): string {
  if (items.length === 0) return "";
  return `${items.map((item) => formatCell(item)).join("\n")}\n`;
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
