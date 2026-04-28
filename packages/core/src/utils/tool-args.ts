import type { TargetResult, Tool } from "./output.ts";

export type { Tool };

export function extractHelpFlag(args: string[]): { help: boolean; rest: string[] } {
  const rest = args.filter((a) => a !== "--help" && a !== "-h");
  return { help: rest.length < args.length, rest };
}

export function parseToolArgs(rawArgs: string[], inputSchema: Record<string, unknown>): Record<string, unknown> {
  const props = (inputSchema["properties"] as Record<string, { type?: string | string[] }> | undefined) ?? {};

  // --args '{...}' spreads a JSON object as the base, individual --flags override.
  // Bypass when the tool schema explicitly defines an "args" property.
  const argsSchemaBypass = "args" in props;
  const baseFromArgs: Record<string, unknown> = {};

  if (!argsSchemaBypass) {
    for (let j = 0; j < rawArgs.length; j++) {
      const arg = rawArgs[j] ?? "";
      let rawVal: string | undefined;

      if (arg === "--args") {
        const next = rawArgs[j + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("--args requires a JSON object value");
        }
        rawVal = next;
        j++;
      } else if (arg.startsWith("--args=")) {
        rawVal = arg.slice("--args=".length);
      } else {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawVal);
      } catch (e) {
        throw new Error(`Invalid JSON in --args: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("--args must be a plain JSON object (not array, null, or primitive)");
      }
      Object.assign(baseFromArgs, parsed as Record<string, unknown>);
    }
  }

  const result: Record<string, unknown> = {};

  let i = 0;
  while (i < rawArgs.length) {
    // Skip --args tokens (already processed above)
    if (!argsSchemaBypass) {
      const arg0 = rawArgs[i] ?? "";
      if (arg0 === "--args") {
        i += 2;
        continue;
      }
      if (arg0.startsWith("--args=")) {
        i++;
        continue;
      }
    }
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

  return Object.assign(baseFromArgs, result);
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

  lines.push("", "Flags:");
  lines.push(`  --args '{"key":"value"}'   Pass all inputs as a JSON object (individual --flags override)`);

  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
