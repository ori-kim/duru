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
      if (!pluginsDir) {
        return ctx.exit(1, { error: { message: "DURU_HOME is not set." } });
      }

      await removePlugin(pluginsDir, name);
      return ctx.exit(0, { deleted: name });
    });
}
