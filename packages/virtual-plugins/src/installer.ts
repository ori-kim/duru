import { pathToFileURL } from "node:url";
import type { Cli } from "@clip/core";
import { type InstallVirtualPluginsOptions, discoverVirtualPluginManifests } from "./manifest.ts";
import { isVirtualPlugin } from "./virtual-plugin.ts";

export type InstalledVirtualPlugin = {
  name: string;
  manifestPath: string;
  entryPath: string;
  order: number;
};

export async function installVirtualPlugins(
  cli: Cli,
  options: InstallVirtualPluginsOptions = {},
): Promise<readonly InstalledVirtualPlugin[]> {
  const manifests = await discoverVirtualPluginManifests(options);
  const installed: InstalledVirtualPlugin[] = [];

  for (const manifest of manifests) {
    const module = (await import(pathToFileURL(manifest.entryPath).href)) as { default?: unknown };
    const plugin = module.default;
    if (!isVirtualPlugin(plugin)) {
      throw new Error(
        `Invalid virtual plugin export for "${manifest.name}": expected default export from virtualPlugin(...)`,
      );
    }

    await plugin.install(cli);
    installed.push({
      name: manifest.name,
      manifestPath: manifest.manifestPath,
      entryPath: manifest.entryPath,
      order: manifest.order,
    });
  }

  return installed;
}
