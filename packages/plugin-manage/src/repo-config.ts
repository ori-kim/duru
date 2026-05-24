import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findManifestFile, readManifestInfo } from "./manifest.ts";
import type { DiscoveredPlugin } from "./scan.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export type RepoConfigEntry = {
  path: string;
  name?: string;
  description?: string;
};

export type DuruRepoConfig = {
  plugins: readonly RepoConfigEntry[];
};

// ── File discovery ────────────────────────────────────────────────────────────

const configFileNames = ["duru.config.toml", "duru.config.yml", "duru.config.yaml", "duru.config.json"] as const;

export async function readRepoConfig(dir: string): Promise<DuruRepoConfig | null> {
  for (const fileName of configFileNames) {
    const filePath = join(dir, fileName);
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    return parseRepoConfig(source, fileName);
  }
  return null;
}

// ── Plugin resolution ─────────────────────────────────────────────────────────

// Resolve declared plugin paths from a duru.config into DiscoveredPlugin list.
// Each entry's `path` is resolved relative to `repoRoot`.
// Metadata priority: duru.config entry > duru.plugin.yml > directory name.
export async function resolveConfigPlugins(repoRoot: string, config: DuruRepoConfig): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];

  for (const entry of config.plugins) {
    if (!entry.path) continue;
    const pluginDir = resolve(repoRoot, entry.path);

    // Read from duru.plugin.yml if present (for fallback metadata)
    const manifestPath = await findManifestFile(pluginDir);
    const manifestInfo = manifestPath ? await readManifestInfo(manifestPath).catch(() => null) : null;

    // Config entry takes precedence over manifest
    const name = entry.name ?? manifestInfo?.name ?? pluginDir.split("/").at(-1) ?? "unknown";
    const description = entry.description ?? manifestInfo?.description;

    discovered.push({ name, description, sourceDir: pluginDir });
  }

  return discovered;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseRepoConfig(source: string, fileName: string): DuruRepoConfig {
  if (fileName.endsWith(".json")) return parseJsonConfig(source, fileName);
  if (fileName.endsWith(".toml")) return parseTomlConfig(source, fileName);
  return parseYamlConfig(source, fileName); // .yml / .yaml
}

function parseJsonConfig(source: string, fileName: string): DuruRepoConfig {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (err) {
    throw new Error(`Invalid JSON in ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validateRepoConfig(data, fileName);
}

function parseTomlConfig(source: string, fileName: string): DuruRepoConfig {
  const data = Bun.TOML.parse(source);
  return validateRepoConfig(data, fileName);
}

// Minimal YAML parser that handles the specific duru.config structure:
//
//   plugins:
//     - path: some/path
//       name: optional-name
//     - path: other/path
//
// Supports only a top-level `plugins:` key containing a sequence of mappings.
function parseYamlConfig(source: string, fileName: string): DuruRepoConfig {
  const plugins: RepoConfigEntry[] = [];
  let inPlugins = false;
  let currentItem: Record<string, string> | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    const trimmed = line.trim();

    // Root-level key
    if (indent === 0) {
      if (trimmed === "plugins:" || trimmed.startsWith("plugins:")) {
        inPlugins = true;
        if (currentItem) {
          plugins.push(currentItem as RepoConfigEntry);
          currentItem = null;
        }
        continue;
      }
      // Any other root key → stop plugins block
      inPlugins = false;
      continue;
    }

    if (!inPlugins) continue;

    // List item: `  - path: ...`  or  `  -`
    if (trimmed.startsWith("- ") || trimmed === "-") {
      if (currentItem) plugins.push(currentItem as RepoConfigEntry);
      currentItem = {};
      const rest = trimmed.slice(1).trim(); // strip leading `-`
      if (rest) {
        const kv = parseKv(rest, fileName);
        if (kv) currentItem[kv.key] = kv.value;
      }
      continue;
    }

    // Property of current item: `    key: value`
    if (currentItem) {
      const kv = parseKv(trimmed, fileName);
      if (kv) currentItem[kv.key] = kv.value;
    }
  }

  if (currentItem) plugins.push(currentItem as RepoConfigEntry);

  return { plugins };
}

function parseKv(line: string, _fileName: string): { key: string; value: string } | null {
  const sep = line.indexOf(":");
  if (sep < 0) return null;
  const key = line.slice(0, sep).trim();
  const raw = line.slice(sep + 1).trim();
  if (!key) return null;
  // Strip surrounding quotes
  const value =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw;
  return { key, value };
}

function stripYamlComment(line: string): string {
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

// ── Validation ────────────────────────────────────────────────────────────────

function validateRepoConfig(data: unknown, fileName: string): DuruRepoConfig {
  if (!isRecord(data)) throw new Error(`${fileName}: config must be an object`);
  if (!Array.isArray(data.plugins)) throw new Error(`${fileName}: "plugins" must be an array`);

  const plugins: RepoConfigEntry[] = [];
  for (const [i, item] of data.plugins.entries()) {
    if (!isRecord(item)) throw new Error(`${fileName}: plugins[${i}] must be an object`);
    if (typeof item.path !== "string" || !item.path.trim()) {
      throw new Error(`${fileName}: plugins[${i}].path is required and must be a non-empty string`);
    }
    plugins.push({
      path: item.path.trim(),
      ...(typeof item.name === "string" ? { name: item.name.trim() } : {}),
      ...(typeof item.description === "string" ? { description: item.description.trim() } : {}),
    });
  }

  return { plugins };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
