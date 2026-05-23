import type { CompletionContext, CompletionContributor, CompletionItem } from "@duru/cli-kit";
import type {
  CliGatewayOptions,
  GatewayAdapter,
  GatewayAliasRecord,
  GatewayBindingRecord,
  GatewayProfileRecord,
  GatewayTargetRecord,
} from "../types";

export type GatewayCompletionContributorOptions = {
  namespace?: string;
};

export function createGatewayCompletionContributor(
  options: CliGatewayOptions,
  contributorOptions: GatewayCompletionContributorOptions = {},
): CompletionContributor {
  const namespace = contributorOptions.namespace ?? "gateway";
  return {
    id: "duru.gateway",
    async complete(ctx) {
      return completeGateway(ctx, options, namespace);
    },
  };
}

async function completeGateway(
  ctx: CompletionContext,
  options: CliGatewayOptions,
  namespace: string,
): Promise<readonly CompletionItem[]> {
  if (ctx.argv[0] === namespace && ctx.position > 0) {
    return completeGateway(gatewayNamespaceContext(ctx), options, namespace);
  }

  const current = ctx.current;

  if (current.includes("@")) return profileReferenceItems(current, options);
  if (isTargetParameterPosition(ctx)) return targetReferenceItems(current, options);
  if (ctx.position === 0) return rootGatewayItems(current, options);

  return targetOperationItems(ctx, options);
}

function gatewayNamespaceContext(ctx: CompletionContext): CompletionContext {
  const argv = ctx.argv.slice(1);
  const position = Math.max(0, ctx.position - 1);
  return {
    argv,
    cursor: Math.max(0, ctx.cursor - 1),
    current: argv[position] ?? "",
    previous: position > 0 ? argv[position - 1] : undefined,
    position,
  };
}

async function rootGatewayItems(current: string, options: CliGatewayOptions): Promise<readonly CompletionItem[]> {
  const targets = await options.store.listTargets();
  const bindings = await options.store.listBindings();

  return [...targets.map(targetItem), ...bindings.map(bindingItem)].filter((item) => item.value.startsWith(current));
}

async function targetReferenceItems(current: string, options: CliGatewayOptions): Promise<readonly CompletionItem[]> {
  const targets = await options.store.listTargets();
  const items: CompletionItem[] = [];
  for (const target of targets) {
    items.push(targetItem(target));
    for (const profile of await options.store.listProfiles(target.name)) {
      items.push(profileItem(target, profile));
    }
  }
  return items.filter((item) => item.value.startsWith(current));
}

async function profileReferenceItems(current: string, options: CliGatewayOptions): Promise<readonly CompletionItem[]> {
  const [targetName] = current.split("@", 1);
  const target = targetName ? await options.store.getTarget(targetName) : undefined;
  if (!target) return [];

  return (await options.store.listProfiles(target.name))
    .map((profile) => profileItem(target, profile))
    .filter((item) => item.value.startsWith(current));
}

async function targetOperationItems(
  ctx: CompletionContext,
  options: CliGatewayOptions,
): Promise<readonly CompletionItem[]> {
  const reference = targetReference(ctx.argv[0]);
  if (!reference) return [];

  const binding = await targetBinding(reference.name, options);
  const target = await options.store.getTarget(binding?.target ?? reference.name);
  if (!target) return [];

  const profileName = reference.profile ?? binding?.profile ?? target.defaultProfile;
  const profile = profileName ? await options.store.getProfile(target.name, profileName) : undefined;
  if (profileName && !profile) return [];

  const items: CompletionItem[] = [];
  const aliases = await options.store.listAliases(target.name);
  items.push(...aliases.map(aliasItem));
  items.push(...commonOperationItems());
  items.push(...(await adapterCompletionItems(target, profile, ctx, options)));

  return items.filter((item) => item.value.startsWith(ctx.current));
}

async function adapterCompletionItems(
  target: GatewayTargetRecord,
  profile: GatewayProfileRecord | undefined,
  ctx: CompletionContext,
  options: CliGatewayOptions,
): Promise<readonly CompletionItem[]> {
  const adapter = (options.adapters ?? []).find((item) => item.type === target.type);
  if (!adapter) return [];

  try {
    const manifest = mergeTargetProfile(target, profile);
    const config = parseTargetConfig(adapter, manifest);
    const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
    const fromTarget = await gatewayTarget.complete?.({
      argv: ctx.argv.slice(1),
      target: target.name,
      ...(profile?.name ? { profile: profile.name } : {}),
    });
    const cachedCatalog = await options.store.getCatalog?.(target.name);
    const catalog = cachedCatalog?.operations ?? (await gatewayTarget.catalog?.({ target: target.name }));

    return [
      ...(fromTarget ?? []).map((item) => ({ ...item, group: item.group ?? "gateway operations" })),
      ...(catalog ?? []).map((tool) => ({
        value: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        kind: "operation" as const,
        group: "gateway operations",
      })),
    ];
  } catch {
    return [];
  }
}

function isTargetParameterPosition(ctx: CompletionContext): boolean {
  const [first, second] = ctx.argv;
  if (ctx.position === 1 && targetCommands.has(first ?? "")) return true;
  if (ctx.position === 2 && first === "alias" && aliasTargetCommands.has(second ?? "")) return true;
  if (ctx.position === 2 && first === "profile" && profileTargetCommands.has(second ?? "")) return true;
  if (ctx.position === 2 && first === "bind") return true;
  return false;
}

const targetCommands = new Set(["remove", "refresh", "inspect", "auth", "login", "logout"]);
const aliasTargetCommands = new Set(["add", "list", "remove"]);
const profileTargetCommands = new Set(["add", "list", "remove", "use", "unset"]);

function targetItem(target: GatewayTargetRecord): CompletionItem {
  return {
    value: target.name,
    description: `${target.type} target`,
    kind: "target",
    group: `${target.type}-targets`,
  };
}

function bindingItem(binding: GatewayBindingRecord): CompletionItem {
  return {
    value: binding.name,
    description: `${binding.profile ? `${binding.target}@${binding.profile}` : binding.target} binding`,
    kind: "alias",
    group: "gateway bindings",
  };
}

function profileItem(target: GatewayTargetRecord, profile: GatewayProfileRecord): CompletionItem {
  return {
    value: `${target.name}@${profile.name}`,
    description: profile.name === target.defaultProfile ? "active profile" : "profile",
    kind: "profile",
    group: "gateway profiles",
  };
}

function aliasItem(alias: GatewayAliasRecord): CompletionItem {
  return {
    value: alias.name,
    description: `alias for ${alias.operation}`,
    kind: "alias",
    group: "gateway aliases",
  };
}

function commonOperationItems(): readonly CompletionItem[] {
  return [
    { value: "tools", description: "List operations", kind: "operation", group: "gateway operations" },
    { value: "describe", description: "Describe an operation", kind: "operation", group: "gateway operations" },
    { value: "types", description: "List types", kind: "operation", group: "gateway operations" },
  ];
}

function targetReference(value: string | undefined): { name: string; profile?: string } | undefined {
  if (!value) return undefined;
  const separator = value.indexOf("@");
  if (separator <= 0) return { name: value };
  const profile = value.slice(separator + 1);
  if (!profile) return { name: value.slice(0, separator) };
  return { name: value.slice(0, separator), profile };
}

async function targetBinding(name: string, options: CliGatewayOptions): Promise<GatewayBindingRecord | undefined> {
  if (await options.store.getTarget(name)) return undefined;
  return options.store.getBinding(name);
}

function parseTargetConfig<TConfig>(adapter: GatewayAdapter<TConfig>, target: GatewayTargetRecord): TConfig {
  return adapter.schema.parse(target.config);
}

function mergeTargetProfile(
  target: GatewayTargetRecord,
  profile: GatewayProfileRecord | undefined,
): GatewayTargetRecord {
  if (!profile?.config) return target;
  return {
    ...target,
    config: mergeConfig(target.config, profile.config),
  };
}

function mergeConfig(targetConfig: unknown, profileConfig: unknown): unknown {
  if (!isRecord(targetConfig) || !isRecord(profileConfig)) return profileConfig;
  return { ...targetConfig, ...profileConfig };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
