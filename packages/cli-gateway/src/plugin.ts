import { createPlugin } from "@clip/kit";
import { installGatewayCommands } from "./commands";
import type { CliGatewayOptions, CliGatewayPlugin, GatewayAdapter } from "./types";

export function cliGateway(options: CliGatewayOptions): CliGatewayPlugin {
  return createPlugin((api) => {
    installGatewayCommands(api, options);
  });
}

export function defaultGatewayAdapters(): readonly GatewayAdapter[] {
  return [];
}
