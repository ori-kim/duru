import type { TargetResult, Tool } from "../extension.ts";

export type { Tool };

export function extractHelpFlag(args: string[]): { help: boolean; rest: string[] } {
  const rest = args.filter((a) => a !== "--help" && a !== "-h");
  return { help: rest.length < args.length, rest };
}

export function parseToolArgs(rawArgs: string[], inputSchema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const props = (inputSchema["properties"] as Record<string, { type?: string | string[] }> | undefined) ?? {};

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i] ?? "";

    const eqIdx = arg.indexOf("=");
    let key: string;
    let rawVal: string | undefined;

    if (arg.startsWith("--")) {
      if (eqIdx >= 0) {
        key = arg.slice(2, eqIdx);
        rawVal = arg.slice(eqIdx + 1);
        i++;
      } else {
        key = arg.slice(2);
        const next = rawArgs[i + 1];
        if (!next || next.startsWith("--")) {
          result[key] = true;
          i++;
          continue;
        }
        rawVal = next;
        i += 2;
      }
    } else if (eqIdx > 0) {
      key = arg.slice(0, eqIdx);
      rawVal = arg.slice(eqIdx + 1);
      i++;
    } else {
      i++;
      continue;
    }

    const propDef = props[key];
    const propType = Array.isArray(propDef?.type) ? propDef.type[0] : propDef?.type;

    if (propType === "number" || propType === "integer") {
      result[key] = Number(rawVal);
    } else if (propType === "boolean") {
      result[key] = rawVal === "true" || rawVal === "1";
    } else if (propType === "string") {
      result[key] = rawVal;
    } else if (propType === "object" || propType === "array") {
      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        result[key] = rawVal;
      }
    } else {
      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        result[key] = rawVal;
      }
    }
  }

  return result;
}

export function formatToolHelp(tool: Tool): TargetResult {
  const schema = tool.inputSchema;
  const props = (schema["properties"] as Record<string, { type?: unknown; default?: unknown }> | undefined) ?? {};
  const required = new Set((schema["required"] as string[] | undefined) ?? []);

  const lines = [`Usage: clip <target> ${tool.name} [--param value ...]`, "", tool.description];

  if (Object.keys(props).length > 0) {
    lines.push("", "Parameters:");
    for (const [name, prop] of Object.entries(props).sort()) {
      const type = Array.isArray(prop.type)
        ? prop.type.filter((t) => t !== "null").join("|")
        : String(prop.type ?? "any");
      const req = required.has(name) ? " (required)" : "";
      const def = prop.default != null ? `  [default: ${prop.default}]` : "";
      lines.push(`  --${name.padEnd(22)} ${type}${req}${def}`);
    }
  }

  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
