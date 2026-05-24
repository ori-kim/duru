import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const MANIFEST_FILE = "plugins.yml";

export type ContributesSpec = {
  commands?: string[];
  eager?: boolean;
};

export type PluginEntry = {
  name: string;
  path: string;
  entry: string;
  enabled?: boolean;
  order?: number;
  description?: string;
  contributes?: ContributesSpec;
};

export type PluginManifestDefaults = { enabled?: boolean };

export type PluginManifest = {
  defaults?: PluginManifestDefaults;
  plugins: PluginEntry[];
};

export type ResolvedPlugin = {
  name: string;
  entryAbsPath: string;
  order: number;
  contributes: ContributesSpec;
  enabled: boolean;
};

export type LoadPluginsOptions = {
  home?: string;
  manifestPath?: string;
};

export function resolveManifestPath(options: LoadPluginsOptions): string | undefined {
  if (options.manifestPath) return resolve(options.manifestPath);
  const home = options.home ?? process.env.DURU_HOME;
  return home ? join(resolve(home), "plugins", MANIFEST_FILE) : undefined;
}

export async function loadPluginManifest(options: LoadPluginsOptions): Promise<ResolvedPlugin[]> {
  const manifestPath = resolveManifestPath(options);
  if (!manifestPath) return [];
  let raw: string;
  try { raw = await readFile(manifestPath, "utf8"); }
  catch (err) { if (isNotFoundError(err)) return []; throw err; }
  const data = yamlParse(raw) as PluginManifest | null;
  if (!data || !Array.isArray(data.plugins)) return [];
  const globalEnabled = data.defaults?.enabled ?? true;
  const manifestDir = dirname(manifestPath);
  return data.plugins
    .map((entry): ResolvedPlugin | null => {
      const enabled = entry.enabled ?? globalEnabled;
      if (!enabled) return null;
      const entryPath = join(entry.path, entry.entry);
      const entryAbsPath = isAbsolute(entryPath) ? entryPath : resolve(manifestDir, entryPath);
      return {
        name: entry.name,
        entryAbsPath,
        order: entry.order ?? 1000,
        contributes: entry.contributes ?? {},
        enabled: true,
      };
    })
    .filter((p): p is ResolvedPlugin => p !== null)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function upsertPlugin(options: LoadPluginsOptions, entry: PluginEntry): Promise<void> {
  const manifestPath = resolveManifestPath(options);
  if (!manifestPath) throw new Error("DURU_HOME is not set");
  let data: PluginManifest = { plugins: [] };
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = yamlParse(raw) as PluginManifest | null;
    if (parsed?.plugins) data = parsed;
  } catch (err) { if (!isNotFoundError(err)) throw err; }
  const idx = data.plugins.findIndex((p) => p.name === entry.name);
  if (idx >= 0) { data.plugins[idx] = entry; } else { data.plugins.push(entry); }
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, yamlStringify(data), "utf8");
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}
