import { createPlugin } from "@clip/kit";
import type { CliEventContext } from "@clip/kit";
import { apiAdapter } from "./adapters/api";
import { cliAdapter } from "./adapters/cli";
import { graphqlAdapter } from "./adapters/graphql";
import { mcpAdapter } from "./adapters/mcp";
import { scriptAdapter } from "./adapters/script";
import { installGatewayCommands } from "./commands";
import { runGatewayTargetInvocation } from "./runtime";
import type { CliGatewayOptions, CliGatewayPlugin, GatewayAdapter } from "./types";

export function cliGateway(options: CliGatewayOptions): CliGatewayPlugin {
  return createPlugin((api) => {
    installGatewayCommands(api, options);
    api.on("notFound", (ctx) => runGatewayTargetInvocation(ctx as CliEventContext<"notFound">, options));
  });
}

export function defaultGatewayAdapters(): readonly GatewayAdapter[] {
  return [cliAdapter(), scriptAdapter(), apiAdapter(), graphqlAdapter(), mcpAdapter()];
}
