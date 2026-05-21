import type { Renderer } from "@clip/core";

export function jsonRenderer(): Renderer {
  return {
    id: "json",
    render(outputs) {
      return {
        stdout: `${JSON.stringify(outputs, null, 2)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}
