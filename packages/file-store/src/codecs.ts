import { DuruFileStoreCodecError } from "./errors";
import type { FileCodec } from "./types";

export function jsonCodec(): FileCodec {
  return {
    id: "json",
    extensions: [".json"],
    parse: (text) => JSON.parse(text),
    stringify: (value) => `${JSON.stringify(value, null, 2)}\n`,
  };
}

export function yamlCodec(): FileCodec {
  return {
    id: "yaml",
    extensions: [".yaml", ".yml"],
    parse: (text) => Bun.YAML.parse(text),
    stringify: (value) => Bun.YAML.stringify(value),
  };
}

export function tomlCodec(): FileCodec {
  return {
    id: "toml",
    extensions: [".toml"],
    parse: (text) => Bun.TOML.parse(text),
    stringify: (value) => stringifyToml(value),
  };
}

export function defaultCodecs(): readonly FileCodec[] {
  return [jsonCodec(), yamlCodec(), tomlCodec()];
}

export type CodecRegistry = {
  readonly byId: Map<string, FileCodec>;
  readonly byExtension: Map<string, FileCodec>;
};

export function codecRegistry(codecs: readonly FileCodec[]): CodecRegistry {
  const byId = new Map<string, FileCodec>();
  const byExtension = new Map<string, FileCodec>();
  for (const codec of codecs) {
    byId.set(codec.id, codec);
    for (const extension of codec.extensions) byExtension.set(extension.toLowerCase(), codec);
  }
  return { byId, byExtension };
}

export function codecById(registry: CodecRegistry, id: string): FileCodec {
  const codec = registry.byId.get(id);
  if (!codec) throw new DuruFileStoreCodecError(id);
  return codec;
}

export function codecByPath(registry: CodecRegistry, path: string): FileCodec {
  const extension = path.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase();
  const codec = extension ? registry.byExtension.get(extension) : undefined;
  if (!codec) throw new DuruFileStoreCodecError(path);
  return codec;
}

function stringifyToml(value: unknown): string {
  if (!isPlainObject(value)) throw new Error("TOML root value must be an object");
  const lines: string[] = [];
  writeTomlTable(lines, "", value);
  return `${lines.join("\n")}\n`;
}

function writeTomlTable(lines: string[], prefix: string, value: Record<string, unknown>): void {
  const nested: Array<[string, Record<string, unknown>]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (isPlainObject(item)) {
      nested.push([key, item]);
      continue;
    }
    lines.push(`${tomlKey(key)} = ${tomlValue(item)}`);
  }
  for (const [key, item] of nested) {
    if (lines.length > 0) lines.push("");
    const tableName = prefix ? `${prefix}.${tomlKey(key)}` : tomlKey(key);
    lines.push(`[${tableName}]`);
    writeTomlTable(lines, tableName, item);
  }
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Unsupported TOML value: ${String(value)}`);
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
