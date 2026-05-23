import { createCli } from "@duru/cli-kit";
import type { CliPluginApi, Context } from "@duru/cli-kit";
import { runGatewayTargetInvocation } from "./runtime";
import type { CliGatewayOptions, GatewayBindingRecord, GatewaySnapshot, GatewayTool } from "./types";

type InvocationRouteHost = Pick<CliPluginApi, "command" | "route">;

type InvocationCommandHost = {
  command(pattern: string, description?: string): InvocationCommandBuilder;
};

type InvocationCommandBuilder = {
  hidden(hidden?: boolean): InvocationCommandBuilder;
  action(handler: (ctx: InvocationActionContext) => unknown): InvocationCommandBuilder;
};

type InvocationActionContext = Pick<Context, "request" | "params" | "options" | "exit">;

const gatewayManagementCommands = new Set([
  "add",
  "list",
  "check",
  "remove",
  "bind",
  "binds",
  "unbind",
  "refresh",
  "inspect",
  "auth",
  "login",
  "logout",
  "alias",
  "profile",
]);

const gatewayTargetCommands = new Set(["tools", "describe", "types", "--help", "-h"]);

export function installTargetRoutes(
  api: InvocationRouteHost,
  options: CliGatewayOptions,
  pluginOptions: { namespace: string },
  snapshot: GatewaySnapshot | undefined,
): void {
  if (!snapshot) return;

  const namespaceCli = createCli();
  const seen = new Set<string>();
  const catalogByTarget = new Map(snapshot.catalogs.map((catalog) => [catalog.target, catalog.operations]));
  for (const target of snapshot.targets) {
    const operations = catalogByTarget.get(target.name) ?? [];
    installInvocationCommand(api, target.name, target.name, options, seen, operations);
    installInvocationCommand(
      namespaceCli,
      target.name,
      target.name,
      options,
      seen,
      operations,
      pluginOptions.namespace,
      {
        includeDefault: !gatewayManagementCommands.has(target.name),
      },
    );
  }
  for (const binding of snapshot.bindings) {
    const operations = catalogByTarget.get(binding.target) ?? [];
    installBindingCommand(api, binding, options, seen, operations);
    installBindingCommand(namespaceCli, binding, options, seen, operations, pluginOptions.namespace, {
      includeDefault: !gatewayManagementCommands.has(binding.name),
    });
  }
  api.route(pluginOptions.namespace, namespaceCli);
}

export function routeSnapshot(options: CliGatewayOptions): GatewaySnapshot | undefined {
  return options.snapshot ?? options.store.snapshot?.();
}

export function routedInvocationNames(snapshot: GatewaySnapshot | undefined): Set<string> {
  const values = new Set<string>();
  for (const target of snapshot?.targets ?? []) values.add(target.name);
  for (const binding of snapshot?.bindings ?? []) values.add(binding.name);
  return values;
}

export function isRoutedInvocation(value: string | undefined, routedNames: ReadonlySet<string>): boolean {
  const name = targetName(value);
  return name !== undefined && routedNames.has(name);
}

export function targetHelpArgv(
  argv: readonly string[],
  positionals: readonly string[],
  namespace: string,
  routedNames: ReadonlySet<string>,
): readonly string[] | undefined {
  const [root, target] = positionals;
  if (root === namespace && isRoutedInvocation(target, routedNames)) {
    const namespaceIndex = findSubsequence(argv, pathTokens(namespace));
    return namespaceIndex === -1 ? positionals.slice(1) : argv.slice(namespaceIndex + pathTokens(namespace).length);
  }
  if (isRoutedInvocation(root, routedNames)) return argv;
  return undefined;
}

function installInvocationCommand(
  host: InvocationRouteHost,
  patternRoot: string,
  invocationRoot: string,
  options: CliGatewayOptions,
  seen: Set<string>,
  operations: readonly GatewayTool[],
  scope?: string,
  routeOptions: { includeDefault?: boolean } = {},
): void {
  const hasOperationRoutes = installOperationRoutes(
    host,
    patternRoot,
    invocationRoot,
    operations,
    options,
    seen,
    scope,
  );

  if (routeOptions.includeDefault) {
    const defaultKey = scope ? `${scope} ${patternRoot}` : patternRoot;
    if (!seen.has(defaultKey)) {
      seen.add(defaultKey);
      host
        .command(patternRoot, "Run a gateway target")
        .hidden()
        .action((ctx) =>
          runGatewayTargetInvocation(
            {
              ...ctx,
              argv: targetCommandArgv(ctx.request.argv, invocationRoot, patternRoot, scope),
            },
            options,
          ),
        );
    }
  }

  if (hasOperationRoutes) return;

  const pattern = `${patternRoot} <operation> [...args]`;
  const key = scope ? `${scope} ${pattern}` : pattern;
  if (seen.has(key)) return;
  seen.add(key);
  host
    .command(pattern, "Run a gateway target")
    .hidden()
    .action((ctx) =>
      runGatewayTargetInvocation(
        {
          ...ctx,
          argv: targetCommandArgv(ctx.request.argv, invocationRoot, patternRoot, scope),
        },
        options,
      ),
    );
}

function installBindingCommand(
  host: InvocationRouteHost,
  binding: GatewayBindingRecord,
  options: CliGatewayOptions,
  seen: Set<string>,
  operations: readonly GatewayTool[],
  scope?: string,
  routeOptions?: { includeDefault?: boolean },
): void {
  installInvocationCommand(host, binding.name, binding.name, options, seen, operations, scope, routeOptions);
}

function installOperationRoutes(
  host: InvocationRouteHost,
  patternRoot: string,
  invocationRoot: string,
  operations: readonly GatewayTool[],
  options: CliGatewayOptions,
  seen: Set<string>,
  scope?: string,
): boolean {
  const operationCli = createCli();
  let hasOperationRoute = false;
  for (const operation of operations) {
    hasOperationRoute =
      addOperationCommand(operationCli, patternRoot, invocationRoot, operation, options, seen, scope) ||
      hasOperationRoute;
  }
  if (hasOperationRoute) host.route(patternRoot, operationCli);
  return hasOperationRoute;
}

function addOperationCommand(
  host: InvocationCommandHost,
  patternRoot: string,
  invocationRoot: string,
  operation: GatewayTool,
  options: CliGatewayOptions,
  seen: Set<string>,
  scope?: string,
): boolean {
  if (!isRouteOperationName(operation.name)) return false;

  const pattern = `${operation.name} [...args]`;
  const key = scope ? `${scope} ${patternRoot} ${pattern}` : `${patternRoot} ${pattern}`;
  if (seen.has(key)) return false;
  seen.add(key);
  host
    .command(pattern, operation.description ?? "Run a gateway operation")
    .hidden()
    .action((ctx) =>
      runGatewayTargetInvocation(
        {
          ...ctx,
          argv: targetCommandArgv(ctx.request.argv, invocationRoot, patternRoot, scope),
        },
        options,
      ),
    );
  return true;
}

function targetName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("@");
  return separator <= 0 ? value : value.slice(0, separator);
}

function targetCommandArgv(
  argv: readonly string[],
  invocationRoot: string,
  patternRoot: string,
  scope: string | undefined,
): readonly string[] {
  const prefix = scope ? [...pathTokens(scope), patternRoot] : [patternRoot];
  const index = findSubsequence(argv, prefix);
  return index === -1 ? [invocationRoot] : [invocationRoot, ...argv.slice(index + prefix.length)];
}

function isRouteOperationName(value: string): boolean {
  return Boolean(value) && !/\s/.test(value) && !gatewayTargetCommands.has(value);
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
