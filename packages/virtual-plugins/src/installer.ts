import { pathToFileURL } from "node:url";
import type { CliPlugin } from "@duru/cli-kit";
import { createPlugin } from "@duru/cli-kit";
import { type LoadPluginsOptions, type ResolvedPlugin, loadPluginManifest } from "./manifest.ts";
import { isVirtualPlugin } from "./virtual-plugin.ts";

export type InstalledPlugin = {
  name: string;
  entryAbsPath: string;
  initialized: boolean;
};

export type PluginLoader = {
  phase1Plugins: InstalledPlugin[];
  phase1Commands: Set<string>;
};

const BOOLEAN_FLAGS = new Set(["--help", "-h", "--version", "-v", "--json", "--dry-run", "--debug"]);
const VALUE_FLAGS = new Set(["--config", "-c", "--format"]);

function extractVerb(argv: string[]): string | undefined {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (VALUE_FLAGS.has(a)) { i += 2; continue; }
    if ([...VALUE_FLAGS].some((f) => a.startsWith(`${f}=`))) { i++; continue; }
    if (BOOLEAN_FLAGS.has(a) || [...BOOLEAN_FLAGS].some((f) => a.startsWith(`${f}=`))) { i++; continue; }
    if (a.startsWith("-")) { i++; continue; }
    return a;
  }
  return undefined;
}

const METADATA_VERBS = new Set(["help", "plugin", "completion"]);

function shouldInit(plugin: ResolvedPlugin, argv: string[] | undefined): boolean {
  if (!argv) return true;
  if (plugin.contributes.eager) return true;
  const verb = extractVerb(argv);
  if (!verb) return argv.length === 0 || argv.includes("--help") || argv.includes("-h");
  if (METADATA_VERBS.has(verb)) return true;
  return (plugin.contributes.commands ?? []).includes(verb);
}

export async function installVirtualPlugins(
  cli: Parameters<CliPlugin["install"]>[0]["cli"],
  options: LoadPluginsOptions = {},
  argv?: string[],
): Promise<PluginLoader> {
  const plugins = await loadPluginManifest(options);
  const phase1Plugins: InstalledPlugin[] = [];
  const phase1Commands = new Set<string>();

  for (const plugin of plugins) {
    for (const cmd of plugin.contributes.commands ?? []) phase1Commands.add(cmd);
    const installed: InstalledPlugin = { name: plugin.name, entryAbsPath: plugin.entryAbsPath, initialized: false };
    phase1Plugins.push(installed);
    if (!shouldInit(plugin, argv)) continue;
    const mod = (await import(pathToFileURL(plugin.entryAbsPath).href)) as { default?: unknown };
    const vp = mod.default;
    if (!isVirtualPlugin(vp)) {
      process.stderr.write(`duru: warning: plugin "${plugin.name}" must export default from virtualPlugin(...)\n`);
      continue;
    }
    await vp.install(cli);
    installed.initialized = true;
  }
  return { phase1Plugins, phase1Commands };
}

export function virtualPlugins(options: LoadPluginsOptions = {}, argv?: string[]): CliPlugin {
  return createPlugin(async (api) => { await installVirtualPlugins(api.cli, options, argv); });
}
