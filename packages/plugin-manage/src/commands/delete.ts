import type { Cli } from "@duru/cli-kit";
import { removePlugin, resolvePluginsDir } from "../store.ts";

export function registerDeleteCommand(cli: Cli): void {
  cli
    .command("delete <name>")
    .meta({ description: "Delete an installed plugin" })
    .group("Plugin")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const pluginsDir = resolvePluginsDir();
      await removePlugin(pluginsDir, name);
      return ctx.exit(0, { deleted: name });
    });
}
