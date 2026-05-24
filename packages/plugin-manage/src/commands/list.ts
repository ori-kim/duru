import type { Cli } from "@duru/cli-kit";
import { listInstalledPlugins, resolvePluginsDir } from "../store.ts";

export function registerListCommand(cli: Cli): void {
  cli
    .command("list")
    .meta({ description: "List installed plugins" })
    .group("Plugin")
    .action(async (ctx) => {
      const pluginsDir = resolvePluginsDir();
      if (!pluginsDir) {
        return ctx.exit(1, { error: { message: "DURU_HOME is not set." } });
      }

      const plugins = await listInstalledPlugins(pluginsDir);
      return ctx.exit(0, {
        plugins: plugins.map((p) => ({
          name: p.name,
          description: p.description ?? null,
          enabled: p.enabled,
        })),
      });
    });
}
