import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const manifestFileNames = ["clip.plugin.toml", "clip.plugin.yml", "clip.plugin.yaml"] as const;

export type InstallVirtualPluginsOptions = {
  home?: string;
  pluginsDir?: string;
};

export type VirtualPluginManifest = {
  name: string;
  manifestPath: string;
  entryPath: string;
  order: number;
  description?: string;
};

export async function discoverVirtualPluginManifests(
  options: InstallVirtualPluginsOptions = {},
): Promise<VirtualPluginManifest[]> {
  const pluginsDir = resolvePluginsDir(options);
  if (!pluginsDir) return [];

  const pluginDirs = await readPluginDirs(pluginsDir);
  const manifests: VirtualPluginManifest[] = [];

  for (const pluginDir of pluginDirs) {
    const manifestPath = await findManifest(pluginDir);
    if (!manifestPath) continue;
    const manifest = await readManifest(manifestPath, pluginDir);
    if (manifest) manifests.push(manifest);
  }

  return manifests.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
}

function resolvePluginsDir(options: InstallVirtualPluginsOptions): string | undefined {
  if (options.pluginsDir) return resolve(options.pluginsDir);
  const home = options.home ?? process.env.CLIP_HOME;
  return home ? resolve(home, "plugins") : undefined;
}

async function readPluginDirs(pluginsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginsDir, entry.name))
      .sort();
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function findManifest(pluginDir: string): Promise<string | undefined> {
  const found: string[] = [];
  for (const fileName of manifestFileNames) {
    const path = join(pluginDir, fileName);
    try {
      await readFile(path);
      found.push(path);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  if (found.length > 1) throw new Error(`Multiple virtual plugin manifests found in ${pluginDir}`);
  return found[0];
}

async function readManifest(manifestPath: string, pluginDir: string): Promise<VirtualPluginManifest | undefined> {
  const source = await readFile(manifestPath, "utf8");
  const data = parseManifestSource(manifestPath, source);
  const manifest = validateManifestData(data, manifestPath);
  if (manifest.enabled === false) return undefined;
  return {
    name: manifest.name,
    manifestPath,
    entryPath: resolve(pluginDir, manifest.entry),
    order: manifest.order ?? 1000,
    ...(manifest.description ? { description: manifest.description } : {}),
  };
}

function parseManifestSource(manifestPath: string, source: string): unknown {
  if (manifestPath.endsWith(".toml")) return Bun.TOML.parse(source);
  return parseYamlManifest(source);
}

function parseYamlManifest(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine).trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) throw new Error(`Invalid virtual plugin YAML line: ${rawLine.trim()}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) throw new Error(`Invalid virtual plugin YAML line: ${rawLine.trim()}`);
    data[key] = parseScalar(value);
  }
  return data;
}

function stripYamlComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? undefined : (quote ?? char);
      continue;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function parseScalar(value: string): unknown {
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

type ManifestData = {
  name: string;
  entry: string;
  enabled?: boolean;
  order?: number;
  description?: string;
};

function validateManifestData(value: unknown, manifestPath: string): ManifestData {
  if (!isRecord(value)) throw invalidManifest(manifestPath, "manifest must be an object");
  const name = requiredString(value, "name", manifestPath);
  const entry = requiredString(value, "entry", manifestPath);
  const enabled = optionalBoolean(value, "enabled", manifestPath);
  const order = optionalNumber(value, "order", manifestPath);
  const description = optionalString(value, "description", manifestPath);
  return {
    name,
    entry,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(description ? { description } : {}),
  };
}

function requiredString(value: Record<string, unknown>, field: string, manifestPath: string): string {
  const item = value[field];
  if (typeof item === "string" && item.trim()) return item;
  throw invalidManifest(manifestPath, `Missing required field: ${field}`);
}

function optionalString(value: Record<string, unknown>, field: string, manifestPath: string): string | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (typeof item === "string") return item;
  throw invalidManifest(manifestPath, `Invalid field: ${field} must be a string`);
}

function optionalBoolean(value: Record<string, unknown>, field: string, manifestPath: string): boolean | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (typeof item === "boolean") return item;
  throw invalidManifest(manifestPath, `Invalid field: ${field} must be a boolean`);
}

function optionalNumber(value: Record<string, unknown>, field: string, manifestPath: string): number | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (typeof item === "number" && Number.isFinite(item)) return item;
  throw invalidManifest(manifestPath, `Invalid field: ${field} must be a number`);
}

function invalidManifest(manifestPath: string, message: string): Error {
  return new Error(`Invalid virtual plugin manifest: ${manifestPath}\n${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
