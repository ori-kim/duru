import type { CliPluginApi } from "@clip/kit";
import { unknownAdapterMessage } from "./runtime";
import type { CliGatewayOptions, GatewayAdapter } from "./types";

export function installGatewayCommands(api: CliPluginApi, options: CliGatewayOptions): void {
  const adapters = options.adapters ?? [];

  api
    .command("add <name> [...args]", "Add a gateway target")
    .option("--type <type>", "Gateway adapter type")
    .action(async (ctx) => {
      const name = ctx.params.name;
      const explicitType = stringOption(ctx.options.type);
      const adapter = resolveAddAdapter(adapters, explicitType);
      if (!adapter) return ctx.exit(2, { message: addAdapterMessage(explicitType) });

      const config = adapter.add
        ? await adapter.add({ name, type: adapter.type, argv: stringArrayParam(ctx.params.args) })
        : adapter.schema.parse({});

      await options.store.saveTarget({ name, type: adapter.type, config });

      return { name, type: adapter.type };
    });

  api.command("list", "List gateway targets").action(async () => ({
    targets: (await options.store.listTargets()).map((target) => ({ name: target.name, type: target.type })),
  }));

  api.command("remove <name>", "Remove a gateway target").action(async (ctx) => {
    const name = ctx.params.name;
    await options.store.removeTarget(name);
    return { removed: name };
  });
}

function resolveAddAdapter(
  adapters: readonly GatewayAdapter[],
  explicitType: string | undefined,
): GatewayAdapter | undefined {
  if (explicitType) return adapters.find((adapter) => adapter.type === explicitType);
  if (adapters.length === 1) return adapters[0];
  return undefined;
}

function addAdapterMessage(type: string | undefined): string {
  return type ? unknownAdapterMessage(type) : "Gateway adapter type is required";
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayParam(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}
