import { createCli } from "@clip/kit";
import type { CliPluginApi } from "@clip/kit";
import { unknownAdapterMessage, unknownProfileMessage, unknownTargetMessage } from "./runtime";
import type {
  AuthContext,
  CliGatewayOptions,
  GatewayAdapter,
  GatewayProfileRecord,
  GatewayTargetRecord,
} from "./types";

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
    const target = await options.store.getTarget(name);
    if (!target) return ctx.exit(2, { message: unknownTargetMessage(name) });

    await options.store.removeTarget(name);
    return { removed: name };
  });

  api.command("login <target>", "Login to a gateway target").action(async (ctx) => {
    return authCommand("login", ctx.params.target, options, adapters);
  });

  api.command("logout <target>", "Logout from a gateway target").action(async (ctx) => {
    return authCommand("logout", ctx.params.target, options, adapters);
  });

  const aliases = createCli();

  aliases.command("add <target> <name> <operation> [...args]", "Add a gateway target alias").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    const operation = ctx.params.operation;
    const args = stringArrayParam(ctx.params.args);

    await options.store.saveAlias(target, { target, name, operation, args });

    return { target, name, operation };
  });

  aliases.command("list <target>", "List gateway target aliases").action(async (ctx) => ({
    aliases: (await options.store.listAliases(ctx.params.target)).map((alias) => ({
      target: alias.target,
      name: alias.name,
      operation: alias.operation,
      args: alias.args ?? [],
    })),
  }));

  aliases.command("remove <target> <name>", "Remove a gateway target alias").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    await options.store.removeAlias(target, name);
    return { removed: { target, name } };
  });

  api.route("alias", aliases);

  const profiles = createCli();

  profiles.command("add <target> <name> [...args]", "Add a gateway target profile").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    const args = stringArrayParam(ctx.params.args);

    await options.store.saveProfile(target, { target, name, config: { args } });

    return { target, name };
  });

  profiles.command("list <target>", "List gateway target profiles").action(async (ctx) => ({
    profiles: (await options.store.listProfiles(ctx.params.target)).map((profile) => ({
      target: profile.target,
      name: profile.name,
      config: profile.config,
    })),
  }));

  profiles.command("remove <target> <name>", "Remove a gateway target profile").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    await options.store.removeProfile(target, name);
    return { removed: { target, name } };
  });

  api.route("profile", profiles);
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

async function authCommand(
  action: "login" | "logout",
  targetValue: string,
  options: CliGatewayOptions,
  adapters: readonly GatewayAdapter[],
) {
  const targetRef = targetReference(targetValue);
  const target = await options.store.getTarget(targetRef.name);
  if (!target) return exit(2, { message: unknownTargetMessage(targetRef.name) });

  const adapter = adapters.find((item) => item.type === target.type);
  if (!adapter) return exit(2, { message: unknownAdapterMessage(target.type) });

  const profile = targetRef.profile ? await options.store.getProfile(target.name, targetRef.profile) : undefined;
  if (targetRef.profile && !profile) {
    return exit(2, { message: unknownProfileMessage(target.name, targetRef.profile) });
  }

  const manifest = profile?.config ? { ...target, config: mergeConfig(target.config, profile.config) } : target;
  const config = adapter.schema.parse(manifest.config);
  const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
  const authHandler = gatewayTarget.auth?.[action];
  if (!authHandler) return exit(2, { message: unsupportedAuthMessage(target.type, action) });

  await authHandler(authContext(target.name, targetRef.profile));

  return { target: target.name, type: target.type, action };
}

function targetReference(value: string): { name: string; profile?: string } {
  const separator = value.indexOf("@");
  if (separator <= 0) return { name: value };
  const profile = value.slice(separator + 1);
  if (!profile) return { name: value.slice(0, separator) };

  return { name: value.slice(0, separator), profile };
}

function authContext(target: string, profile: string | undefined): AuthContext {
  return profile ? { target, profile } : { target };
}

function mergeConfig(targetConfig: unknown, profileConfig: unknown): unknown {
  if (!isRecord(targetConfig) || !isRecord(profileConfig)) return profileConfig;
  return { ...targetConfig, ...profileConfig };
}

function unsupportedAuthMessage(type: string, action: "login" | "logout"): string {
  return `Gateway adapter "${type}" does not support ${action}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayParam(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

function exit(exitCode: number, result: unknown) {
  return { kind: "clip.exit", ok: false, exitCode, result } as const;
}
