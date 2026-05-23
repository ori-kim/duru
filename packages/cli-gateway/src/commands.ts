import { createCli } from "@clip/kit";
import type { CliPluginApi } from "@clip/kit";
import { unknownAdapterMessage, unknownProfileMessage, unknownTargetMessage } from "./runtime";
import type {
  AuthContext,
  CliGatewayOptions,
  GatewayAdapter,
  GatewayCheckReport,
  GatewayDiagnostic,
  GatewayInspectReport,
  GatewayTarget,
  GatewayTargetCapabilities,
  GatewayTargetCheck,
  GatewayTargetRecord,
  GatewayTool,
} from "./types";

export function installGatewayCommands(api: CliPluginApi, options: CliGatewayOptions): void {
  const adapters = options.adapters ?? [];

  api
    .command("add <name> [...args]", "Add a gateway target")
    .option("--type <type>", "Gateway adapter type")
    .action(async (ctx) => {
      const name = ctx.params.name;
      const explicitType = stringOption(ctx.options.type);
      const argv = stringArrayParam(ctx.params.args);
      const adapter = await resolveAddAdapter(adapters, { name, type: explicitType, argv });
      if (adapter.kind === "error") return ctx.exit(2, { message: adapter.message });

      const config = adapter.value.add
        ? await adapter.value.add({ name, type: adapter.value.type, argv })
        : adapter.value.schema.parse({});

      await options.store.saveTarget({ name, type: adapter.value.type, config });

      return { name, type: adapter.value.type };
    });

  api.command("list", "List gateway targets").action(async () => ({
    targets: (await options.store.listTargets()).map((target) => ({ name: target.name, type: target.type })),
  }));

  api.command("check", "Check gateway targets").action(async () => {
    return checkCommand(options, adapters);
  });

  api.command("remove <name>", "Remove a gateway target").action(async (ctx) => {
    const name = ctx.params.name;
    const target = await options.store.getTarget(name);
    if (!target) return ctx.exit(2, { message: unknownTargetMessage(name) });

    await options.store.removeTarget(name);
    return { removed: name };
  });

  api.command("refresh <target>", "Refresh a gateway target").action(async (ctx) => {
    return refreshCommand(ctx.params.target, options, adapters);
  });

  api.command("inspect <target>", "Inspect a gateway target").action(async (ctx) => {
    return inspectCommand(ctx.params.target, options, adapters);
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

async function resolveAddAdapter(
  adapters: readonly GatewayAdapter[],
  input: { name: string; type?: string; argv: readonly string[] },
): Promise<{ kind: "ok"; value: GatewayAdapter } | { kind: "error"; message: string }> {
  if (input.type) {
    const adapter = adapters.find((item) => item.type === input.type);
    return adapter ? { kind: "ok", value: adapter } : { kind: "error", message: unknownAdapterMessage(input.type) };
  }

  const detected = [];
  for (const adapter of adapters) {
    if (adapter.detect && (await adapter.detect(input))) detected.push(adapter);
  }

  if (detected.length === 1) return { kind: "ok", value: detected[0] as GatewayAdapter };
  if (detected.length > 1) return { kind: "error", message: ambiguousAdapterMessage(detected) };

  const fallback = adapters.length === 1 ? adapters[0] : adapters.find((adapter) => adapter.type === "cli");
  return fallback ? { kind: "ok", value: fallback } : { kind: "error", message: "Gateway adapter type is required" };
}

function ambiguousAdapterMessage(adapters: readonly GatewayAdapter[]): string {
  return `Gateway target type is ambiguous: ${adapters.map((adapter) => adapter.type).join(", ")}`;
}

async function refreshCommand(targetName: string, options: CliGatewayOptions, adapters: readonly GatewayAdapter[]) {
  const target = await options.store.getTarget(targetName);
  if (!target) return exit(2, { message: unknownTargetMessage(targetName) });

  const adapter = adapters.find((item) => item.type === target.type);
  if (!adapter) return exit(2, { message: unknownAdapterMessage(target.type) });

  const config = adapter.schema.parse(target.config);
  const gatewayTarget = adapter.createTarget({ manifest: target, config, context: options });
  if (!gatewayTarget.refresh) return exit(2, { message: unsupportedAdapterActionMessage(target.type, "refresh") });

  const refreshed = await gatewayTarget.refresh({ target: target.name });
  if (refreshed?.config === undefined) {
    return { target: target.name, type: target.type, refreshed: true, updated: false };
  }

  await options.store.saveTarget({ ...target, config: adapter.schema.parse(refreshed.config) });

  return { target: target.name, type: target.type, refreshed: true, updated: true };
}

async function checkCommand(
  options: CliGatewayOptions,
  adapters: readonly GatewayAdapter[],
): Promise<GatewayCheckReport> {
  const reports: GatewayTargetCheck[] = [];
  const diagnostics: GatewayDiagnostic[] = [];

  for (const target of await options.store.listTargets()) {
    const report = await checkTarget(target, options, adapters);
    reports.push(report);
    diagnostics.push(...report.diagnostics);
  }

  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    scope: "gateway",
    adapters: adapters.map((adapter) => adapter.type),
    targets: reports,
    diagnostics,
  };
}

async function checkTarget(
  target: GatewayTargetRecord,
  options: CliGatewayOptions,
  adapters: readonly GatewayAdapter[],
): Promise<GatewayTargetCheck> {
  const adapter = adapters.find((item) => item.type === target.type);
  const diagnostics: GatewayDiagnostic[] = [];

  if (!adapter) {
    diagnostics.push({
      severity: "error",
      code: "target.type.unregistered",
      message: unknownAdapterMessage(target.type),
      path: ["targets", target.name, "type"],
    });
    return targetCheck(target, diagnostics);
  }

  try {
    const config = adapter.schema.parse(target.config);
    const gatewayTarget = adapter.createTarget({ manifest: target, config, context: options });
    diagnostics.push(...((await gatewayTarget.check?.({ target: target.name }))?.diagnostics ?? []));
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "target.config.invalid",
      message: errorMessage(error),
      path: ["targets", target.name, "config"],
    });
  }

  return targetCheck(target, diagnostics);
}

function targetCheck(target: GatewayTargetRecord, diagnostics: readonly GatewayDiagnostic[]): GatewayTargetCheck {
  return {
    name: target.name,
    type: target.type,
    ok: diagnostics.every((item) => item.severity !== "error"),
    diagnostics,
  };
}

async function inspectCommand(
  targetValue: string,
  options: CliGatewayOptions,
  adapters: readonly GatewayAdapter[],
): Promise<GatewayInspectReport | ReturnType<typeof exit>> {
  const targetRef = targetReference(targetValue);
  const target = await options.store.getTarget(targetRef.name);
  if (!target) return exit(2, { message: unknownTargetMessage(targetRef.name) });

  const profile = targetRef.profile ? await options.store.getProfile(target.name, targetRef.profile) : undefined;
  if (targetRef.profile && !profile) {
    return exit(2, { message: unknownProfileMessage(target.name, targetRef.profile) });
  }

  const adapter = adapters.find((item) => item.type === target.type);
  if (!adapter) {
    return {
      ok: false,
      target: {
        name: target.name,
        type: target.type,
        ...(targetRef.profile ? { profile: targetRef.profile } : {}),
        config: { redacted: true },
        registered: false,
        capabilities: emptyCapabilities(),
        operations: [],
      },
      diagnostics: [
        {
          severity: "error",
          code: "target.type.unregistered",
          message: unknownAdapterMessage(target.type),
          path: ["type"],
        },
      ],
    };
  }

  const manifest = profile?.config ? { ...target, config: mergeConfig(target.config, profile.config) } : target;
  const config = adapter.schema.parse(manifest.config);
  const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
  const row = await gatewayTarget.listRow?.();
  const operations = await inspectOperations(gatewayTarget, target.name);

  return {
    ok: true,
    target: {
      name: target.name,
      type: target.type,
      ...(targetRef.profile ? { profile: targetRef.profile } : {}),
      config: { redacted: true },
      registered: true,
      ...(row?.summary ? { summary: row.summary } : {}),
      capabilities: targetCapabilities(gatewayTarget),
      operations,
    },
    diagnostics: [],
  };
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
  if (!authHandler) return exit(2, { message: unsupportedAdapterActionMessage(target.type, action) });

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

function unsupportedAdapterActionMessage(type: string, action: "login" | "logout" | "refresh"): string {
  return `Gateway adapter "${type}" does not support ${action}`;
}

async function inspectOperations(target: GatewayTarget, name: string): Promise<readonly GatewayTool[]> {
  const operations = await target.catalog?.({ target: name });
  return operations ?? [];
}

function targetCapabilities(target: GatewayTarget): GatewayTargetCapabilities {
  return {
    invoke: true,
    catalog: Boolean(target.catalog),
    refresh: Boolean(target.refresh),
    ...(target.auth
      ? {
          auth: {
            status: Boolean(target.auth.status),
            login: Boolean(target.auth.login),
            logout: Boolean(target.auth.logout),
          },
        }
      : {}),
    complete: Boolean(target.complete),
    check: Boolean(target.check),
  };
}

function emptyCapabilities(): GatewayTargetCapabilities {
  return { invoke: false, catalog: false, refresh: false, complete: false, check: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
