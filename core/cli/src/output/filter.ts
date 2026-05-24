import { getRenderHint } from "../render/marker.ts";

export function parseFilterFields(raw: unknown): readonly string[] {
  const items = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return items
    .flatMap((item) => String(item).split(","))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function applyFieldFilter(value: unknown, fields: readonly string[]): unknown {
  if (fields.length === 0) return value;
  if (getRenderHint(value)) return value;
  if (Array.isArray(value)) {
    if (!value.every(isRecord)) return value;
    return value.map((row) => pickFromRecord(row, fields));
  }
  if (isRecord(value)) return pickFromRecord(value, fields);
  return value;
}

function pickFromRecord(value: Record<string, unknown>, fields: readonly string[]): unknown {
  if (fields.length === 1) {
    const key = fields[0] as string;
    return key in value ? value[key] : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of fields) if (key in value) out[key] = value[key];
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
