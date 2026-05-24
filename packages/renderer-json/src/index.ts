import { applyFieldFilter, createPlugin, parseFilterFields, parseOptionSpec } from "@duru/cli-kit";
import type { CliPlugin, Renderer } from "@duru/cli-kit";

export function jsonRenderer(): Renderer {
  return {
    id: "json",
    render(input, ctx) {
      const fields = parseFilterFields((ctx.options as { outputFilter?: unknown }).outputFilter);
      const filtered = applyFieldFilter(input.value, fields);
      const value = ctx.options.events ? { result: filtered, events: input.events } : filtered;
      return {
        stdout: `${JSON.stringify(value ?? null, null, 2)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
    stream(value, ctx) {
      const fields = parseFilterFields((ctx.options as { outputFilter?: unknown }).outputFilter);
      const filtered = applyFieldFilter(value, fields);
      ctx.io.stdout.write(`${JSON.stringify(filtered ?? null)}\n`);
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
