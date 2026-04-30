import type { TargetResult, Tool } from "./output.ts";
import { hardenToolInput } from "./agent-safety.ts";

export type { Tool };

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
};

export function extractHelpFlag(args: string[]): { help: boolean; rest: string[] } {
  const rest = args.filter((a) => a !== "--help" && a !== "-h");
  return { help: rest.length < args.length, rest };
}

function schemaType(schema: JsonSchema | undefined): string | undefined {
  const t = schema?.type;
  return Array.isArray(t) ? t.find((v) => v !== "null") : t;
}

function parseJsonValue(rawVal: string | undefined, key: string): unknown {
  try {
    return JSON.parse(rawVal ?? "");
  } catch (e) {
    throw new Error(`Invalid JSON for --${key}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function parseBoolean(rawVal: string | undefined, key: string): boolean {
  if (rawVal === undefined) return true;
  if (rawVal === "true" || rawVal === "1") return true;
  if (rawVal === "false" || rawVal === "0") return false;
  throw new Error(`Invalid --${key}: expected boolean, got ${JSON.stringify(rawVal)}`);
}

function parseNumber(rawVal: string | undefined, key: string, integer: boolean): number {
  const n = Number(rawVal);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
    throw new Error(`Invalid --${key}: expected ${integer ? "integer" : "number"}, got ${JSON.stringify(rawVal)}`);
  }
  return n;
}

function coerceArgValue(key: string, rawVal: string | undefined, propDef: JsonSchema | undefined): unknown {
  const propType = schemaType(propDef);

  if (propType === "number" || propType === "integer") {
    return parseNumber(rawVal, key, propType === "integer");
  }
  if (propType === "boolean") {
    return parseBoolean(rawVal, key);
  }
  if (propType === "string") {
    return rawVal;
  }
  if (propType === "object" || propType === "array") {
    return parseJsonValue(rawVal, key);
  }

  try {
    return JSON.parse(rawVal ?? "");
  } catch {
    return rawVal;
  }
}

function hasSchemaType(schema: JsonSchema, type: string): boolean {
  const t = schema.type;
  if (!t) return true;
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function validateAgainstSchema(value: unknown, schema: JsonSchema, path: string): void {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    throw new Error(`Invalid ${path}: expected one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  }

  const actual = valueType(value);
  if (!hasSchemaType(schema, actual) && !(actual === "integer" && hasSchemaType(schema, "number"))) {
    const expected = Array.isArray(schema.type) ? schema.type.join("|") : schema.type;
    throw new Error(`Invalid ${path}: expected ${expected}, got ${actual}`);
  }

  if (actual === "object") {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in obj)) throw new Error(`Missing required argument: ${path}.${requiredKey}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) throw new Error(`Unknown argument: ${path}.${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(props)) {
      if (key in obj) validateAgainstSchema(obj[key], childSchema, `${path}.${key}`);
    }
  }

  if (actual === "array" && schema.items) {
    const itemSchema = schema.items;
    (value as unknown[]).forEach((item, index) => validateAgainstSchema(item, itemSchema, `${path}[${index}]`));
  }
}

export function parseToolArgs(rawArgs: string[], inputSchema: Record<string, unknown>): Record<string, unknown> {
  const schema = inputSchema as JsonSchema;
  const props = schema.properties ?? {};

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

    result[key] = coerceArgValue(key, rawVal, props[key]);
  }

  const merged = hardenToolInput(Object.assign(baseFromArgs, result));
  validateAgainstSchema(merged, schema, "args");
  return merged;
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
