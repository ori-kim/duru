import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findManifestFile, readManifestInfo, setPluginEnabled } from "./manifest.ts";

export type InstalledPlugin = {
  name: string;
  description?: string;
  enabled: boolean;
  pluginDir: string; // absolute path: DURU_HOME/plugins/<name>
  manifestPath: string;
};

export function resolvePluginsDir(): string | undefined {
  const home = process.env.DURU_HOME;
  return home ? resolve(home, "plugins") : undefined;
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

export async function copyPlugin(sourceDir: string, pluginsDir: string, dirName: string): Promise<void> {
  await mkdir(pluginsDir, { recursive: true });
  await cp(sourceDir, join(pluginsDir, dirName), { recursive: true });
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
