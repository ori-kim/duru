import type { CliEventContext } from "@clip/kit";
import type {
  CliGatewayOptions,
  GatewayAdapter,
  GatewayBindingRecord,
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
  const argv = await targetArgv(bindingArgv(binding, stripGatewayOptions(ctx.argv.slice(1))), target.name, options);
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

  return [alias.operation, ...(alias.args ?? []), ...argv.slice(1)];
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

  if (target.deny?.includes(operation)) {
    return `Gateway target "${target.name}" denied operation: "${operation}"`;
  }

  if (target.allow && target.allow.length > 0 && !target.allow.includes(operation)) {
    return `Gateway target "${target.name}" does not allow operation: "${operation}"`;
  }

  return undefined;
}

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
