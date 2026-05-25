import type { Cli } from "@duru/cli-kit";
import { resolvePluginsDir, togglePlugin } from "../store.ts";

export function registerDisableCommand(cli: Cli): void {
  cli
    .command("disable <name>")
    .meta({ description: "Disable an installed plugin" })
    .group("Plugin")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const pluginsDir = resolvePluginsDir();

      await togglePlugin(pluginsDir, name, false);
      return ctx.exit(0, { name, enabled: false });
    });
}
