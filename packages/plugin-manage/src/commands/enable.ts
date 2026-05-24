import type { Cli } from "@duru/cli-kit";
import { resolvePluginsDir, togglePlugin } from "../store.ts";

export function registerEnableCommand(cli: Cli): void {
  cli
    .command("enable <name>")
    .meta({ description: "Enable an installed plugin" })
    .group("Plugin")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const pluginsDir = resolvePluginsDir();
      if (!pluginsDir) {
        return ctx.exit(1, { error: { message: "DURU_HOME is not set." } });
      }

      await togglePlugin(pluginsDir, name, true);
      return ctx.exit(0, { name, enabled: true });
    });
}
