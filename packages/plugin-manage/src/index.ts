import { createCli } from "@duru/cli-kit";
import { registerDeleteCommand } from "./commands/delete.ts";
import { registerDisableCommand } from "./commands/disable.ts";
import { registerEnableCommand } from "./commands/enable.ts";
import { registerInstallCommand } from "./commands/install.ts";
import { registerListCommand } from "./commands/list.ts";

export const pluginManageCli = createCli();

// Root: duru plugin → show help
pluginManageCli.command().meta({ description: "Manage duru virtual plugins" }).group("Built-in");

registerListCommand(pluginManageCli);
registerInstallCommand(pluginManageCli);
registerDeleteCommand(pluginManageCli);
registerEnableCommand(pluginManageCli);
registerDisableCommand(pluginManageCli);
