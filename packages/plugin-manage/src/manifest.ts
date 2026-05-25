import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const manifestNames = ["duru.plugin.toml", "duru.plugin.yml", "duru.plugin.yaml"] as const;

export type ManifestInfo = {
  name: string;
  description?: string;
  enabled: boolean;
  entry?: string;
};

// Scan a directory for its first manifest file
export async function findManifestFile(pluginDir: string): Promise<string | undefined> {
  for (const name of manifestNames) {
    const path = join(pluginDir, name);
    try {
      await readFile(path);
      return path;
    } catch {
      // not found, try next
    }
  }
  return undefined;
}

export async function readManifestInfo(manifestPath: string): Promise<ManifestInfo> {
  const source = await readFile(manifestPath, "utf8");
  const data = parseSimple(source, manifestPath);
  return {
    name: typeof data.name === "string" && data.name ? data.name : "unknown",
    description: typeof data.description === "string" ? data.description : undefined,
    enabled: data.enabled !== false,
    entry: typeof data.entry === "string" ? data.entry : undefined,
  };
}

// Toggle the enabled field in a manifest file (YAML or TOML).
// Uses text-level replacement — safe for the flat single-level format duru manifests use.
export async function setPluginEnabled(manifestPath: string, enabled: boolean): Promise<void> {
  const content = await readFile(manifestPath, "utf8");
  const isToml = manifestPath.endsWith(".toml");
  const enabledLine = isToml ? `enabled = ${enabled}` : `enabled: ${enabled}`;
  const pattern = isToml ? /^enabled\s*=.*/m : /^enabled\s*:.*/m;

  let updated: string;
  if (pattern.test(content)) {
    updated = content.replace(pattern, enabledLine);
  } else {
    // Append before trailing newline if any
    updated = `${content.trimEnd()}\n${enabledLine}\n`;
  }

  await writeFile(manifestPath, updated, "utf8");
}

// Minimal key: value / key = value parser for flat manifests
function parseSimple(source: string, manifestPath: string): Record<string, unknown> {
  const isToml = manifestPath.endsWith(".toml");
  const result: Record<string, unknown> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sep = line.indexOf(isToml ? "=" : ":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const raw = line.slice(sep + 1).trim();
    if (!key) continue;
    result[key] = parseScalar(raw);
  }
  return result;
}

function stripComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === "'" || ch === '"') && line[i - 1] !== "\\") {
      quote = quote === ch ? undefined : (quote ?? ch);
    } else if (ch === "#" && !quote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
