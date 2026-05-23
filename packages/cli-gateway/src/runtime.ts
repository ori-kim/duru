import type { CliEventContext } from "@clip/kit";
import type {
  CliGatewayOptions,
  GatewayAdapter,
  GatewayProfileRecord,
  GatewayResult,
  GatewayTargetRecord,
} from "./types";

export async function runGatewayTargetInvocation(
  ctx: CliEventContext<"notFound">,
  options: CliGatewayOptions,
): Promise<unknown> {
  const targetRef = targetReference(ctx.argv[0]);
  if (!targetRef) return undefined;

  const target = await options.store.getTarget(targetRef.name);
  if (!target) return undefined;
  const profile = targetRef.profile ? await options.store.getProfile(target.name, targetRef.profile) : undefined;
  if (targetRef.profile && !profile) {
    return ctx.exit(2, { message: unknownProfileMessage(target.name, targetRef.profile) });
  }

  const adapter = (options.adapters ?? []).find((item) => item.type === target.type);
  if (!adapter) return ctx.exit(2, { message: unknownAdapterMessage(target.type) });

  const manifest = mergeTargetProfile(target, profile);
  const config = parseTargetConfig(adapter, manifest);
  const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
  const result = await gatewayTarget.invoke({ argv: await targetArgv(ctx.argv.slice(1), target.name, options) });
  return gatewayExecutionResult(ctx, result);
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

  return [alias.operation, ...(alias.args ?? []), ...argv.slice(1)];
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

function gatewayExecutionResult(ctx: CliEventContext<"notFound">, result: GatewayResult): unknown {
  if (result.ok) return ctx.exit(result.exitCode ?? 0, result.value, true);
  return ctx.exit(result.exitCode ?? 1, errorValue(result.error), false);
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
