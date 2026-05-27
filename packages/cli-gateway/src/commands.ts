import { createCli } from "@duru/cli-kit";
import type { CliPluginApi, CommandPattern } from "@duru/cli-kit";
import { applyTargetEnv } from "./env-interpolation";
import { unknownAdapterMessage, unknownProfileMessage, unknownTargetMessage } from "./runtime";
import type {
  AddInput,
  AuthContext,
  CliGatewayOptions,
  GatewayAdapter,
  GatewayAddResult,
  GatewayBindingRecord,
  GatewayCheckReport,
  GatewayDiagnostic,
  GatewayInspectReport,
  GatewayProfileRecord,
  GatewayTarget,
  GatewayTargetCapabilities,
  GatewayTargetCheck,
  GatewayTargetRecord,
  GatewayTargetSidecars,
  GatewayTool,
} from "./types";

type GatewayCommandHost = Pick<CliPluginApi, "command" | "subCommand">;

export type GatewayCommandInstallOptions = {
  hidden?: boolean;
  group?: string;
};

export function createGatewayCli(
  options: CliGatewayOptions,
  installOptions: GatewayCommandInstallOptions = {},
): ReturnType<typeof createCli> {
  const cli = createCli();
  installGatewayCommands(cli, options, installOptions);
  return cli;
}

export function installGatewayCommands(
  api: GatewayCommandHost,
  options: CliGatewayOptions,
  installOptions: GatewayCommandInstallOptions = {},
): void {
  const adapters = options.adapters ?? [];
  const command = <TPattern extends string>(pattern: CommandPattern<TPattern>, description: string) => {
    return styleCommand(api.command(pattern, description), installOptions);
  };

  command("add <name> [...args]", "Add a gateway target")
    .option("--type <type>", "Gateway adapter type")
    .option("--transport <transport>", "Gateway target transport")
    .option("--description <description>", "Gateway target description")
    .option("--auth <auth>", "Gateway target auth mode")
    .option("--allow <patterns>", "Allowed gateway operations")
    .option("--deny <patterns>", "Denied gateway operations")
    .action(async (ctx) => {
      const name = ctx.params.name;
      const explicitType = stringOption(ctx.options.type);
      const argv = stringArrayParam(ctx.params.args);
      const allow = stringListOption(ctx.options.allow);
      const deny = stringListOption(ctx.options.deny);
      const addOptions = {
        ...(ctx.options.transport ? { transport: ctx.options.transport } : {}),
        ...(ctx.options.description ? { description: ctx.options.description } : {}),
        ...(ctx.options.auth ? { auth: ctx.options.auth } : {}),
      };
      const addInput = { name, type: explicitType, argv, options: addOptions, context: options };
      const adapter = await resolveAddAdapter(adapters, addInput);
      if (adapter.kind === "error") return ctx.exit(2, { message: adapter.message });

      const addResult = adapter.value.add
        ? await adapter.value.add({ ...addInput, type: adapter.value.type })
        : adapter.value.schema.parse({});
      const { targetConfig: config, sidecars } = targetConfigFromAddResult(addResult);
      const target = {
        name,
        type: adapter.value.type,
        config,
        ...(allow.length > 0 ? { allow } : {}),
        ...(deny.length > 0 ? { deny } : {}),
      };

      if (sidecars && options.store.saveTargetWithSidecars) {
        await options.store.saveTargetWithSidecars(target, sidecars);
      } else {
        await options.store.saveTarget(target);
      }

      return { name, type: adapter.value.type };
    });

  command("list", "List gateway targets").action(async () =>
    (await options.store.listTargets()).map((target) => ({ name: target.name, type: target.type })),
  );

  command("check", "Check gateway targets").action(async () => {
    return checkCommand(options, adapters);
  });

  command("remove <name>", "Remove a gateway target").action(async (ctx) => {
    const name = ctx.params.name;
    const target = await options.store.getTarget(name);
    if (!target) return ctx.exit(2, { message: unknownTargetMessage(name) });

    await options.store.removeTarget(name);
    return { removed: name };
  });

  command("bind <name> <target> [...args]", "Bind a command name to a gateway target").action(async (ctx) => {
    return bindCommand(ctx.params.name, ctx.params.target, stringArrayParam(ctx.params.args), ctx, options);
  });

  command("binds", "List gateway target bindings").action(async () =>
    (await options.store.listBindings()).map(bindingRow),
  );

  command("unbind <name>", "Remove a gateway target binding").action(async (ctx) => {
    const name = ctx.params.name;
    const binding = await options.store.getBinding(name);
    if (!binding) return ctx.exit(2, { message: unknownBindingMessage(name) });

    await options.store.removeBinding(name);
    return { removed: name };
  });

  command("refresh <target>", "Refresh a gateway target").action(async (ctx) => {
    return refreshCommand(ctx.params.target, options, adapters);
  });

  command("inspect <target>", "Inspect a gateway target").action(async (ctx) => {
    return inspectCommand(ctx.params.target, options, adapters);
  });

  command("auth <target>", "Show gateway target auth status").action(async (ctx) => {
    return authCommand("status", ctx.params.target, options, adapters);
  });

  command("login <target>", "Login to a gateway target").action(async (ctx) => {
    return authCommand("login", ctx.params.target, options, adapters);
  });

  command("logout <target>", "Logout from a gateway target").action(async (ctx) => {
    return authCommand("logout", ctx.params.target, options, adapters);
  });

  const aliases = createCli();
  const aliasCommand = <TPattern extends string>(pattern: CommandPattern<TPattern>, description: string) => {
    return styleCommand(aliases.command(pattern, description), installOptions);
  };

  aliasCommand("add <target> <name> <operation> [...args]", "Add a gateway target alias")
    .option("--input-json <json>", "Static JSON object input for the alias")
    .action(async (ctx) => {
      const target = ctx.params.target;
      const name = ctx.params.name;
      const operation = ctx.params.operation;
      const args = stringArrayParam(ctx.params.args);
      const input = ctx.options.inputJson === undefined ? undefined : parseJsonObjectOption(ctx.options.inputJson);
      if (input?.kind === "error") return ctx.exit(2, { message: input.message });

      await options.store.saveAlias(target, {
        target,
        name,
        operation,
        ...(input?.value ? { input: input.value } : {}),
        args,
      });

      return { target, name, operation };
    });

  aliasCommand("list <target>", "List gateway target aliases").action(async (ctx) =>
    (await options.store.listAliases(ctx.params.target)).map((alias) => ({
      target: alias.target,
      name: alias.name,
      operation: alias.operation,
      ...(alias.input ? { input: alias.input } : {}),
      args: alias.args ?? [],
    })),
  );

  aliasCommand("remove <target> <name>", "Remove a gateway target alias").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    await options.store.removeAlias(target, name);
    return { removed: { target, name } };
  });

  api.subCommand("alias", aliases);

  const profiles = createCli();
  const profileCommand = <TPattern extends string>(pattern: CommandPattern<TPattern>, description: string) => {
    return styleCommand(profiles.command(pattern, description), installOptions);
  };

  profileCommand("add <target> <name> [...args]", "Add a gateway target profile").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    const args = stringArrayParam(ctx.params.args);

    await options.store.saveProfile(target, { target, name, config: { args } });

    return { target, name };
  });

  profileCommand("list <target>", "List gateway target profiles").action(async (ctx) =>
    profileList(options, ctx.params.target),
  );

  profileCommand("remove <target> <name>", "Remove a gateway target profile").action(async (ctx) => {
    const target = ctx.params.target;
    const name = ctx.params.name;
    const record = await options.store.getTarget(target);
    await options.store.removeProfile(target, name);
    if (record?.defaultProfile === name) {
      await options.store.saveTarget(withoutDefaultProfile(record));
    }
    return { removed: { target, name } };
  });

  profileCommand("use <target> <name>", "Use a gateway target profile by default").action(async (ctx) => {
    const target = await options.store.getTarget(ctx.params.target);
    if (!target) return ctx.exit(2, { message: unknownTargetMessage(ctx.params.target) });

    const profile = await options.store.getProfile(target.name, ctx.params.name);
    if (!profile) return ctx.exit(2, { message: unknownProfileMessage(target.name, ctx.params.name) });

    await options.store.saveTarget({ ...target, defaultProfile: profile.name });

    return { target: target.name, name: profile.name };
  });

  profileCommand("unset <target>", "Unset a gateway target default profile").action(async (ctx) => {
    const target = await options.store.getTarget(ctx.params.target);
    if (!target) return ctx.exit(2, { message: unknownTargetMessage(ctx.params.target) });

    const previous = target.defaultProfile;
    await options.store.saveTarget(withoutDefaultProfile(target));

    return { target: target.name, unset: previous ?? null };
  });

  api.subCommand("profile", profiles);
}

function styleCommand<TBuilder extends { hidden(hidden?: boolean): TBuilder; group(group: string): TBuilder }>(
  builder: TBuilder,
  options: GatewayCommandInstallOptions,
): TBuilder {
  if (options.hidden) builder.hidden();
  if (options.group) builder.group(options.group);
  return builder;
}

function targetConfigFromAddResult<TConfig>(result: TConfig | GatewayAddResult<TConfig>): {
  targetConfig: TConfig;
  sidecars?: GatewayTargetSidecars;
} {
  if (isRecord(result) && result.kind === "gateway.add-result") {
    return result as GatewayAddResult<TConfig>;
  }
  return { targetConfig: result as TConfig };
}

async function resolveAddAdapter(
  adapters: readonly GatewayAdapter[],
  input: AddInput,
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

  const config = await applyTargetEnv(adapter.schema.parse(target.config), {
    manifest: target,
    options,
  });
  let manifest = target;
  let gatewayTarget = adapter.createTarget({ manifest, config, context: options });
  if (!gatewayTarget.refresh && !gatewayTarget.catalog) {
    return exit(2, { message: unsupportedAdapterActionMessage(target.type, "refresh") });
  }

  let updated = false;
  if (gatewayTarget.refresh) {
    const refreshed = await gatewayTarget.refresh({ target: target.name });
    if (refreshed?.config !== undefined) {
      manifest = { ...target, config: adapter.schema.parse(refreshed.config) };
      await options.store.saveTarget(manifest);
      const interpolated = await applyTargetEnv(manifest.config, { manifest, options });
      gatewayTarget = adapter.createTarget({ manifest, config: interpolated, context: options });
      updated = true;
    }
  }

  await refreshTargetCatalog(gatewayTarget, target.name, options);

  return { target: target.name, type: target.type, refreshed: true, updated };
}

async function refreshTargetCatalog(
  target: GatewayTarget,
  targetName: string,
  options: CliGatewayOptions,
): Promise<void> {
  const operations = await target.catalog?.({ target: targetName });
  if (!operations || !options.store.saveCatalog) return;
  await options.store.saveCatalog({ target: targetName, operations, refreshedAt: new Date().toISOString() });
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
    const config = await applyTargetEnv(adapter.schema.parse(target.config), {
      manifest: target,
      options,
    });
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

async function bindCommand(
  name: string,
  targetValue: string,
  args: readonly string[],
  ctx: { exit(exitCode: number, result: unknown): unknown },
  options: CliGatewayOptions,
) {
  if (await options.store.getTarget(name))
    return ctx.exit(2, { message: `Gateway binding conflicts with target: "${name}"` });
  if (await options.store.getBinding(name))
    return ctx.exit(2, { message: `Gateway binding already exists: "${name}"` });

  const targetRef = targetReference(targetValue);
  const target = await options.store.getTarget(targetRef.name);
  if (!target) return ctx.exit(2, { message: unknownTargetMessage(targetRef.name) });

  if (targetRef.profile && !(await options.store.getProfile(target.name, targetRef.profile))) {
    return ctx.exit(2, { message: unknownProfileMessage(target.name, targetRef.profile) });
  }

  const binding: GatewayBindingRecord = {
    name,
    target: target.name,
    ...(targetRef.profile ? { profile: targetRef.profile } : {}),
    args,
  };
  await options.store.saveBinding(binding);

  return bindingRow(binding);
}

function bindingRow(binding: GatewayBindingRecord) {
  return {
    name: binding.name,
    target: binding.profile ? `${binding.target}@${binding.profile}` : binding.target,
    args: binding.args ?? [],
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

  const resolvedProfile = await resolveTargetProfile(target, targetRef.profile, options);
  if (resolvedProfile.kind === "error") return exit(2, { message: resolvedProfile.message });

  const adapter = adapters.find((item) => item.type === target.type);
  if (!adapter) {
    return {
      ok: false,
      target: {
        name: target.name,
        type: target.type,
        ...(resolvedProfile.name ? { profile: resolvedProfile.name } : {}),
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

  const profile = resolvedProfile.profile;
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
      ...(resolvedProfile.name ? { profile: resolvedProfile.name } : {}),
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
  action: "status" | "login" | "logout",
  targetValue: string,
  options: CliGatewayOptions,
  adapters: readonly GatewayAdapter[],
) {
  const targetRef = targetReference(targetValue);
  const target = await options.store.getTarget(targetRef.name);
  if (!target) return exit(2, { message: unknownTargetMessage(targetRef.name) });

  const adapter = adapters.find((item) => item.type === target.type);
  if (!adapter) return exit(2, { message: unknownAdapterMessage(target.type) });

  const resolvedProfile = await resolveTargetProfile(target, targetRef.profile, options);
  if (resolvedProfile.kind === "error") return exit(2, { message: resolvedProfile.message });

  const profile = resolvedProfile.profile;
  const manifest = profile?.config ? { ...target, config: mergeConfig(target.config, profile.config) } : target;
  const config = await applyTargetEnv(adapter.schema.parse(manifest.config), {
    manifest,
    options,
  });
  const gatewayTarget = adapter.createTarget({ manifest, config, profile, context: options });
  const authHandler = gatewayTarget.auth?.[action];
  if (!authHandler) return exit(2, { message: unsupportedAdapterActionMessage(target.type, action) });

  const state = await authHandler(authContext(target.name, resolvedProfile.name));

  if (action === "status") {
    return { target: target.name, type: target.type, action, ...(state ?? { authenticated: false }) };
  }

  return { target: target.name, type: target.type, action };
}

async function profileList(options: CliGatewayOptions, targetName: string) {
  const target = await options.store.getTarget(targetName);
  const active = target?.defaultProfile;

  return (await options.store.listProfiles(targetName)).map((profile) => ({
    target: profile.target,
    name: profile.name,
    config: profile.config,
    ...(profile.name === active ? { active: true } : {}),
  }));
}

async function resolveTargetProfile(
  target: GatewayTargetRecord,
  explicitProfile: string | undefined,
  options: CliGatewayOptions,
): Promise<{ kind: "ok"; name?: string; profile?: GatewayProfileRecord } | { kind: "error"; message: string }> {
  const name = explicitProfile ?? target.defaultProfile;
  if (!name) return { kind: "ok" };

  const profile = await options.store.getProfile(target.name, name);
  if (!profile) return { kind: "error", message: unknownProfileMessage(target.name, name) };

  return { kind: "ok", name, profile };
}

function withoutDefaultProfile(target: GatewayTargetRecord): GatewayTargetRecord {
  const { defaultProfile: _defaultProfile, ...record } = target;
  return record;
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

function unsupportedAdapterActionMessage(type: string, action: "status" | "login" | "logout" | "refresh"): string {
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

function unknownBindingMessage(name: string): string {
  return `Unknown gateway binding: "${name}"`;
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

function stringListOption(value: unknown): readonly string[] {
  const values = stringArrayParam(value);
  return values.flatMap((item) =>
    item
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function parseJsonObjectOption(
  value: unknown,
): { kind: "ok"; value: Record<string, unknown> } | { kind: "error"; message: string } | undefined {
  if (value === undefined) return undefined;
  const text =
    typeof value === "string" ? value : Array.isArray(value) ? String(value[value.length - 1]) : String(value);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return { kind: "error", message: "--input-json must be a JSON object" };
    return { kind: "ok", value: parsed };
  } catch (error) {
    return { kind: "error", message: `Invalid --input-json: ${errorMessage(error)}` };
  }
}

function exit(exitCode: number, result: unknown) {
  return { kind: "duru.exit", ok: false, exitCode, result } as const;
}
