import { createPlugin } from "@clip/kit";
import type { CliPlugin, Renderer } from "@clip/kit";

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

export function textRendererPlugin(): CliPlugin {
  return createPlugin((api) => {
    api.renderer(textRenderer());
    api.defaultRenderer("text");
  });
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
