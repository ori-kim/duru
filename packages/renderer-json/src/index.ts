import { createPlugin, parseOptionSpec } from "@clip/core";
import type { CliPlugin, Renderer } from "@clip/core";

export function jsonRenderer(): Renderer {
  return {
    id: "json",
    render(input, ctx) {
      const value = ctx.options.events ? { result: input.value, events: input.events } : input.value;
      return {
        stdout: `${JSON.stringify(value ?? null, null, 2)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

export function jsonRendererPlugin(): CliPlugin<{ json?: boolean; events?: boolean }> {
  return createPlugin((api) => {
    api.renderer(jsonRenderer());
    api.option(parseOptionSpec("--json", "Render structured JSON output"));
    api.option(parseOptionSpec("--events", "Include emitted events in structured JSON output"));
    api.selectRenderer((ctx) => (ctx.options.json ? "json" : undefined));
  });
}
