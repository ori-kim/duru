import type { Context } from "@clip/kit";
import { formatGatewayTargetHelp, isGatewayTargetHelpDocument } from "./help";
import type {
  CliGatewayOptions,
  GatewayAdapter,
  GatewayBindingRecord,
  GatewayProfileRecord,
  GatewayResult,
  GatewayTargetRecord,
} from "./types";

type GatewayRuntimeContext = Pick<Context, "options" | "exit"> & {
  argv: readonly string[];
};

export async function runGatewayTargetInvocation(
  ctx: GatewayRuntimeContext,
  options: CliGatewayOptions,
): Promise<unknown> {
  const targetRef = targetReference(ctx.argv[0]);
  if (!targetRef) return undefined;

  const binding = await targetBinding(targetRef.name, options);
  const target = await options.store.getTarget(binding?.target ?? targetRef.name);
  if (!target) return undefined;
  const profileName = targetRef.profile ?? binding?.profile ?? target.defaultProfile;
  const profile = profileName ? await options.store.getProfile(target.name, profileName) : undefined;
  if (profileName && !profile) {
    return ctx.exit(2, { message: unknownProfileMessage(target.name, profileName) });
  }

  const adapter = (options.adapters ?? []).find((item) => item.type === target.type);
  if (!adapter) return ctx.exit(2, { message: unknownAdapterMessage(target.type) });

  const manifest = mergeTargetProfile(target, profile);
  const config = parseTargetConfig(adapter, manifest);
  const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
  const argv = await targetArgv(
    stripEmptyInvocationOptions(bindingArgv(binding, stripGatewayOptions(ctx.argv.slice(1)))),
    target.name,
    options,
  );
  const aclError = targetAclError(manifest, argv);
  if (aclError) return ctx.exit(2, { message: aclError });

  const timeout = targetTimeout(manifest, options);
  try {
    const result = await gatewayTarget.invoke({
      argv,
      dryRun: dryRunOption(ctx.options),
      ...(timeout.signal ? { signal: timeout.signal } : {}),
    });
    return gatewayExecutionResult(ctx, result);
  } finally {
    timeout.dispose();
  }
}

function targetReference(value: string | undefined): { name: string; profile?: string } | undefined {
  if (!value) return undefined;

  const separator = value.indexOf("@");
  if (separator <= 0) return { name: value };
  const profile = value.slice(separator + 1);
  if (!profile) return { name: value.slice(0, separator) };

  return { name: value.slice(0, separator), profile };
}

async function targetArgv(
  argv: readonly string[],
  target: string,
  options: CliGatewayOptions,
): Promise<readonly string[]> {
  const aliasName = argv[0];
  if (!aliasName) return argv;

  const alias = (await options.store.listAliases(target)).find((item) => item.name === aliasName);
  if (!alias) return argv;

  return [alias.operation, ...aliasInputArgv(alias.input), ...(alias.args ?? []), ...argv.slice(1)];
}

function aliasInputArgv(input: Record<string, unknown> | undefined): readonly string[] {
  return input ? [JSON.stringify(input)] : [];
}

async function targetBinding(name: string, options: CliGatewayOptions): Promise<GatewayBindingRecord | undefined> {
  if (await options.store.getTarget(name)) return undefined;
  return options.store.getBinding(name);
}

function bindingArgv(binding: GatewayBindingRecord | undefined, argv: readonly string[]): readonly string[] {
  return binding ? [...(binding.args ?? []), ...argv] : argv;
}

function stripGatewayOptions(argv: readonly string[]): readonly string[] {
  return argv.filter((item) => item !== "--dry-run");
}

function stripEmptyInvocationOptions(argv: readonly string[]): readonly string[] {
  return argv.length > 0 && argv.every((item) => emptyInvocationOptions.has(item)) ? [] : argv;
}

const emptyInvocationOptions = new Set(["--json", "--events"]);

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

function targetAclError(target: GatewayTargetRecord, argv: readonly string[]): string | undefined {
  const operation = argv[0];
  if (!operation) return undefined;
  if (isGatewayIntrospectionOperation(operation)) return undefined;

  const treeError = target.acl ? targetTreeAclError(target.name, target.acl, operation, argv[1]) : undefined;
  if (treeError) return treeError;
  if (target.acl && Object.hasOwn(target.acl, operation)) return undefined;

  if (target.deny && matchesAny(target.deny, operation)) {
    return `Gateway target "${target.name}" denied operation: "${operation}"`;
  }

  if (target.allow && target.allow.length > 0 && !matchesAny(target.allow, operation)) {
    return `Gateway target "${target.name}" does not allow operation: "${operation}"`;
  }

  return undefined;
}

function targetTreeAclError(
  targetName: string,
  acl: Record<string, unknown>,
  operation: string,
  subOperation: string | undefined,
): string | undefined {
  const node = acl[operation];
  if (!isRecord(node) || !subOperation) return undefined;

  const deny = stringArray(node.deny);
  const fullOperation = `${operation} ${subOperation}`;
  if (deny && matchesAny(deny, subOperation)) {
    return `Gateway target "${targetName}" denied operation: "${fullOperation}"`;
  }

  const allow = stringArray(node.allow);
  if (allow && allow.length > 0 && !matchesAny(allow, subOperation)) {
    return `Gateway target "${targetName}" does not allow operation: "${fullOperation}". Allowed: ${allow.join(", ")}`;
  }

  return undefined;
}

function isGatewayIntrospectionOperation(operation: string): boolean {
  return gatewayIntrospectionOperations.has(operation);
}

const gatewayIntrospectionOperations = new Set(["tools", "describe", "types", "--help", "-h"]);

function targetTimeout(
  target: GatewayTargetRecord,
  options: CliGatewayOptions,
): { signal?: AbortSignal; dispose(): void } {
  const timeoutMs = target.timeoutMs ?? parseTimeoutMs(options.env?.CLIP_TARGET_TIMEOUT_MS);
  if (timeoutMs === undefined) return { dispose() {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    },
  };
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : undefined;
}

function dryRunOption(options: Record<string, unknown>): boolean {
  return options.dryRun === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function matchesAny(patterns: readonly string[], value: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, value));
}

function matchesPattern(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}

function gatewayExecutionResult(ctx: GatewayRuntimeContext, result: GatewayResult): unknown {
  if (result.ok) return ctx.exit(result.exitCode ?? 0, outputValue(ctx, result.value), true);
  return ctx.exit(result.exitCode ?? 1, errorValue(result.error), false);
}

function outputValue(ctx: GatewayRuntimeContext, value: unknown): unknown {
  if (ctx.options.json === true) return value;
  if (isGatewayTargetHelpDocument(value)) return formatGatewayTargetHelp(value);
  return value;
}

function errorValue(error: unknown): unknown {
  if (error instanceof Error) return { message: error.message };
  return error;
}

export function unknownAdapterMessage(type: string): string {
  return `Unknown gateway adapter type: "${type}"`;
}

export function unknownTargetMessage(target: string): string {
  return `Unknown gateway target: "${target}"`;
}

export function unknownProfileMessage(target: string, profile: string): string {
  return `Unknown gateway profile: "${target}@${profile}"`;
}
