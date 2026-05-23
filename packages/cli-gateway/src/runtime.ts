import type { CliEventContext } from "@clip/kit";
import type { CliGatewayOptions, GatewayAdapter, GatewayResult, GatewayTargetRecord } from "./types";

export async function runGatewayTargetInvocation(
  ctx: CliEventContext<"notFound">,
  options: CliGatewayOptions,
): Promise<unknown> {
  const targetName = ctx.argv[0];
  if (!targetName) return undefined;

  const target = await options.store.getTarget(targetName);
  if (!target) return undefined;

  const adapter = (options.adapters ?? []).find((item) => item.type === target.type);
  if (!adapter) return ctx.exit(2, { message: unknownAdapterMessage(target.type) });

  const config = parseTargetConfig(adapter, target);
  const gatewayTarget = adapter.createTarget({ manifest: target, config, context: options });
  const result = await gatewayTarget.invoke({ argv: await targetArgv(ctx.argv.slice(1), target.name, options) });
  return gatewayExecutionResult(ctx, result);
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
