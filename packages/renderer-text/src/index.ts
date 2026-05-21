import type { Renderer } from "@clip/core";

export function textRenderer(): Renderer {
  return {
    id: "text",
    render(input) {
      return {
        stdout: formatText(input.value),
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

function formatText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return line(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return line(String(value));
  }
  return line(JSON.stringify(value));
}

function line(value: string | undefined): string {
  return value ? `${value}\n` : "";
}
