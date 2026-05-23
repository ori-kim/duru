import { createPlugin, parseOptionSpec } from "@clip/kit";
import type { CliEventContext, HelpRoute } from "@clip/kit";
import { apiAdapter } from "./adapters/api";
import { cliAdapter } from "./adapters/cli";
import { graphqlAdapter } from "./adapters/graphql";
import { grpcAdapter } from "./adapters/grpc";
import { mcpAdapter } from "./adapters/mcp";
import { scriptAdapter } from "./adapters/script";
import { createGatewayCompletionContributor } from "./completion";
import {
  installTargetRoutes,
  isRoutedInvocation,
  routeSnapshot,
  routedInvocationNames,
  targetHelpArgv,
} from "./route-invocations";
import { runGatewayTargetInvocation } from "./runtime";
import type { CliGatewayOptions, CliGatewayPlugin, GatewayAdapter, GatewaySnapshot } from "./types";

export type CliGatewayPluginOptions = {
  namespace?: string;
  group?: string;
};

export function cliGateway(options: CliGatewayOptions, pluginOptions: CliGatewayPluginOptions = {}): CliGatewayPlugin {
  return createPlugin((api) => {
    const namespace = pluginOptions.namespace ?? "gateway";
    const group = pluginOptions.group ?? "Gateway";
    const snapshot = routeSnapshot(options);
    const routedNames = routedInvocationNames(snapshot);
    api.option(parseOptionSpec("--dry-run", "Preview gateway target execution"));
    installTargetRoutes(api, options, { namespace }, snapshot);
    api.helpRoutes(() => [
      {
        pattern: `${namespace} <target> [...args]`,
        description: "Run a gateway target",
        group,
        options: [],
      },
    ]);
    api.completion(createGatewayCompletionContributor(options, { namespace }));
    api.middleware(async (ctx, next) => {
      const routes = api.helpDocument([]).routes;
      const routedHelpArgv = targetHelpArgv(ctx.request.argv, ctx.request.positionals, namespace, routedNames);
      if (ctx.options.help && routedHelpArgv) {
        return (await runGatewayTargetInvocation({ ...ctx, argv: routedHelpArgv }, options)) ?? next();
      }

      const gatewayArgv = gatewayTargetArgv(ctx.request.argv, ctx.request.positionals, routes, namespace);
      if (gatewayArgv && !isRoutedInvocation(gatewayArgv[0], routedNames)) {
        return (await runGatewayTargetInvocation({ ...ctx, argv: gatewayArgv }, options)) ?? next();
      }

      if (ctx.options.help && shouldPassGatewayHelp(ctx.request.positionals, routes)) {
        return (await runGatewayTargetInvocation({ ...ctx, argv: ctx.request.argv }, options)) ?? next();
      }

      return next();
    });
    api.on("notFound", (ctx) => runGatewayTargetInvocation(ctx as CliEventContext<"notFound">, options));
  });
}

export function defaultGatewayAdapters(): readonly GatewayAdapter[] {
  return [cliAdapter(), scriptAdapter(), apiAdapter(), graphqlAdapter(), mcpAdapter(), grpcAdapter()];
}

export async function loadGatewaySnapshot(options: Pick<CliGatewayOptions, "store">): Promise<GatewaySnapshot> {
  return {
    targets: await options.store.listTargets(),
    bindings: await options.store.listBindings(),
    catalogs: (await options.store.listCatalogs?.()) ?? [],
  };
}

function shouldPassGatewayHelp(positionals: readonly string[], routes: readonly HelpRoute[]): boolean {
  const [root] = positionals;
  if (!root) return false;
  return !staticRouteRoots(routes).has(root);
}

function gatewayTargetArgv(
  argv: readonly string[],
  positionals: readonly string[],
  routes: readonly HelpRoute[],
  namespace: string,
): readonly string[] | undefined {
  const namespaceTokens = pathTokens(namespace);
  const gatewaySubcommand = positionals[namespaceTokens.length];
  if (
    !startsWith(positionals, namespaceTokens) ||
    !gatewaySubcommand ||
    staticGatewaySubcommands(routes, namespaceTokens).has(gatewaySubcommand)
  ) {
    return undefined;
  }

  const gatewayIndex = findSubsequence(argv, namespaceTokens);
  return gatewayIndex === -1
    ? positionals.slice(namespaceTokens.length)
    : argv.slice(gatewayIndex + namespaceTokens.length);
}

function staticRouteRoots(routes: readonly HelpRoute[]): Set<string> {
  const roots = new Set<string>();
  for (const route of routes) {
    for (const pattern of [route.pattern, ...(route.aliases ?? [])]) {
      const root = pattern.trim().split(/\s+/)[0];
      if (root && !root.startsWith("<") && !root.startsWith("[")) roots.add(root);
    }
  }
  return roots;
}

function staticGatewaySubcommands(routes: readonly HelpRoute[], namespaceTokens: readonly string[]): Set<string> {
  const subcommands = new Set<string>();
  for (const route of routes) {
    for (const pattern of [route.pattern, ...(route.aliases ?? [])]) {
      const tokens = pattern.trim().split(/\s+/);
      const subcommand = tokens[namespaceTokens.length];
      if (
        !startsWith(tokens, namespaceTokens) ||
        !subcommand ||
        subcommand.startsWith("<") ||
        subcommand.startsWith("[")
      ) {
        continue;
      }
      subcommands.add(subcommand);
    }
  }
  return subcommands;
}

function pathTokens(path: string): readonly string[] {
  return path.trim().split(/\s+/).filter(Boolean);
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.every((value, index) => values[index] === value);
}

function findSubsequence(values: readonly string[], subsequence: readonly string[]): number {
  if (subsequence.length === 0) return -1;
  for (let index = 0; index <= values.length - subsequence.length; index += 1) {
    if (startsWith(values.slice(index), subsequence)) return index;
  }
  return -1;
}
