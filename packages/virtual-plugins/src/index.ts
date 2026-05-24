export type { InstalledPlugin, PluginLoader } from "./installer.ts";
export { installVirtualPlugins } from "./installer.ts";
export type { ContributesSpec, LoadPluginsOptions, PluginEntry, PluginManifest, ResolvedPlugin } from "./manifest.ts";
export { loadPluginManifest, resolveManifestPath, upsertPlugin } from "./manifest.ts";
export type { VirtualPlugin, VirtualPluginInstaller } from "./virtual-plugin.ts";
export { isVirtualPlugin, virtualPlugin } from "./virtual-plugin.ts";
