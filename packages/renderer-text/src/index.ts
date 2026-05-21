import type { Output, Renderer } from "@clip/core";

export function textRenderer(): Renderer {
  return {
    id: "text",
    render(outputs) {
      const stdout = outputs.flatMap((output) =>
        output.kind === "log" && output.stream === "stderr" ? [] : [renderOutput(output)],
      );
      const stderr = outputs.flatMap((output) =>
        output.kind === "log" && output.stream === "stderr" ? [output.text] : [],
      );
      return {
        stdout: joinLines(stdout),
        stderr: joinLines(stderr),
        exitCode: 0,
      };
    },
  };
}

function renderOutput(output: Output): string {
  if (output.kind === "text") return output.text;
  if (output.kind === "log") return output.text;
  if (output.kind === "data" || output.kind === "view")
    return JSON.stringify(output.kind === "data" ? output.value : output.value);
  if (output.kind === "task") return `${output.status}: ${output.title}${output.message ? ` - ${output.message}` : ""}`;
  return renderTable(output.rows);
}

function renderTable(rows: readonly Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.join("\t"), ...rows.map((row) => headers.map((header) => String(row[header] ?? "")).join("\t"))].join(
    "\n",
  );
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
