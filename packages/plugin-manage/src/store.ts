import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { findManifestFile, readManifestInfo, setPluginEnabled } from "./manifest.ts";
import type { DiscoveredPlugin } from "./scan.ts";

export type InstalledPlugin = {
  name: string;
  description?: string;
  enabled: boolean;
  pluginDir: string; // absolute path: DURU_HOME/plugins/<name>
  manifestPath: string;
};

// Resolves the plugins directory using the same fallback chain as
// `@duru/file-store`'s `createDuruFileHome`: DURU_HOME env, then ~/.duru.
export function resolvePluginsDir(): string {
  const home = process.env.DURU_HOME ?? join(homedir(), ".duru");
  return resolve(home, "plugins");
}

export async function listInstalledPlugins(pluginsDir: string): Promise<readonly InstalledPlugin[]> {
  let names: string[];
  try {
    names = await readdir(pluginsDir);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const plugins: InstalledPlugin[] = [];
  for (const name of names) {
    const pluginDir = join(pluginsDir, name);
    const dirInfo = await stat(pluginDir).catch(() => null);
    if (!dirInfo?.isDirectory()) continue;
    const manifestPath = await findManifestFile(pluginDir);
    if (!manifestPath) continue;
    const info = await readManifestInfo(manifestPath);
    plugins.push({ name: info.name, description: info.description, enabled: info.enabled, pluginDir, manifestPath });
  }

  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

export async function pluginExists(pluginsDir: string, name: string): Promise<boolean> {
  try {
    return (await stat(join(pluginsDir, name))).isDirectory();
  } catch {
    return false;
  }
}

// Copy a discovered plugin to DURU_HOME/plugins/<dirName>/.
// If the plugin was declared via duru.config (has `entry`) and the source dir
// contains no duru.plugin.yml, one is auto-generated in the destination so that
// installVirtualPlugins can find and load the plugin.
export async function copyPlugin(plugin: DiscoveredPlugin, pluginsDir: string, dirName: string): Promise<void> {
  await mkdir(pluginsDir, { recursive: true });
  const destDir = join(pluginsDir, dirName);
  await cp(plugin.sourceDir, destDir, { recursive: true });

  if (plugin.entry) {
    // Only generate if the copied dir still has no manifest
    const existing = await findManifestFile(destDir);
    if (!existing) {
      await writeGeneratedManifest(destDir, plugin);
    }
  }
}

async function writeGeneratedManifest(destDir: string, plugin: DiscoveredPlugin): Promise<void> {
  const lines: string[] = [`name: ${plugin.name}`];
  if (plugin.description) lines.push(`description: ${plugin.description}`);
  lines.push(`entry: ${plugin.entry}`);
  await writeFile(join(destDir, "duru.plugin.yml"), `${lines.join("\n")}\n`, "utf8");
}

export async function removePlugin(pluginsDir: string, name: string): Promise<void> {
  const dir = join(pluginsDir, name);
  const exists = await pluginExists(pluginsDir, name);
  if (!exists) throw new Error(`Plugin "${name}" is not installed.`);
  await rm(dir, { recursive: true, force: true });
}

export async function togglePlugin(pluginsDir: string, name: string, enabled: boolean): Promise<void> {
  const pluginDir = join(pluginsDir, name);
  const manifestPath = await findManifestFile(pluginDir);
  if (!manifestPath) {
    if (!(await pluginExists(pluginsDir, name))) throw new Error(`Plugin "${name}" is not installed.`);
    throw new Error(`Plugin "${name}" has no manifest file.`);
  }
  await setPluginEnabled(manifestPath, enabled);
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}
