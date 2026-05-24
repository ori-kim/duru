import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { findManifestFile, readManifestInfo } from "./manifest.ts";
import { readRepoConfig, resolveConfigPlugins } from "./repo-config.ts";

export type DiscoveredPlugin = {
  name: string;
  description?: string;
  sourceDir: string; // absolute path to the plugin directory
  // Present when discovered via duru.config — used to generate duru.plugin.yml
  // in the installed destination if the source dir has no manifest of its own.
  entry?: string;
};

// Scan `dir` for plugins using the following priority:
//
//   1. dir itself has duru.plugin.{yml,toml} → single plugin (leaf)
//   2. dir root has duru.config.{yml,toml,json} → declared plugin paths
//   3. Fallback: immediate subdirectories that contain a duru.plugin manifest
//
// This means a repository can organize plugins anywhere and just declare them
// in a duru.config.yml at the root — no fixed "plugins/" folder required.
export async function discoverPluginsInDir(dir: string): Promise<DiscoveredPlugin[]> {
  // ── 1. dir itself is a plugin ──────────────────────────────────────────────
  const selfManifest = await findManifestFile(dir);
  if (selfManifest) {
    const info = await readManifestInfo(selfManifest);
    return [{ name: info.name, description: info.description, sourceDir: dir }];
  }

  // ── 2. duru.config at root ─────────────────────────────────────────────────
  const repoConfig = await readRepoConfig(dir);
  if (repoConfig) {
    const plugins = await resolveConfigPlugins(dir, repoConfig);
    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── 3. Fallback: scan immediate subdirectories ─────────────────────────────
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
