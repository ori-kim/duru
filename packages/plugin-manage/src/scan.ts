import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { findManifestFile, readManifestInfo } from "./manifest.ts";

export type DiscoveredPlugin = {
  name: string;
  description?: string;
  sourceDir: string; // absolute path to the plugin directory
};

// Scan `dir` for immediate subdirectories that contain a duru.plugin manifest.
// If `dir` itself has a manifest, treat it as a single plugin root.
export async function discoverPluginsInDir(dir: string): Promise<DiscoveredPlugin[]> {
  // First check: is `dir` itself a single plugin?
  const selfManifest = await findManifestFile(dir);
  if (selfManifest) {
    const info = await readManifestInfo(selfManifest);
    return [{ name: info.name, description: info.description, sourceDir: dir }];
  }

  // Otherwise scan immediate subdirectories
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const discovered: DiscoveredPlugin[] = [];
  for (const name of names) {
    const subdir = join(dir, name);
    const info = await stat(subdir).catch(() => null);
    if (!info?.isDirectory()) continue;
    const manifestPath = await findManifestFile(subdir);
    if (!manifestPath) continue;
    const pluginInfo = await readManifestInfo(manifestPath);
    discovered.push({ name: pluginInfo.name, description: pluginInfo.description, sourceDir: subdir });
  }

  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}
