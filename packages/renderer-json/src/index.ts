import type { Renderer } from "@clip/core";

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
