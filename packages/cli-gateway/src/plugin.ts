import { createPlugin } from "@clip/kit";
import type { CliGatewayOptions, CliGatewayPlugin, GatewayAdapter } from "./types";

export function cliGateway(_options: CliGatewayOptions): CliGatewayPlugin {
  return createPlugin(() => {});
}

export function defaultGatewayAdapters(): readonly GatewayAdapter[] {
  return [];
}
