#!/usr/bin/env bun
/**
 * apps/clip/src/main.ts — 모노레포 조립 entry
 *
 * builtin-loader.ts의 createDefaultRegistry()를 사용해 registry를 생성한다.
 * 특정 extension을 제거하려면 builtin-loader.ts의 BUILTIN_EXTENSIONS 배열에서 관리한다.
 *
 * skills 커맨드는 내장에서 제거됨 — ~/.clip/extensions/extensions.yml manifest에
 * skills entry를 선언해야 `clip skills` 동작.
 */
import "./virtual-modules.ts";
import {
  ClipError,
  checkAcl,
  dispatch,
  formatToolHelp,
  getTarget,
  loadConfig,
  outputRegistry,
  printAndExit,
} from "@clip/core";
import type {
  AclTree,
  CliCommandSummary,
  ClipExtension,
  HasAliases,
  OptionSpec,
  OptionValue,
  ResolvedTarget,
  TargetResult,
} from "@clip/core";
import type { Registry } from "@clip/core";
import { createDefaultRegistry } from "./builtin-loader.ts";
import { runAdd } from "./cli/add.ts";
import { runConfigCmd } from "./cli/config-cmd.ts";
import { HELP, VERSION, printTargetHelp } from "./cli/help.ts";
import { runList } from "./cli/list.ts";
import { runLogin, runLogout } from "./cli/login.ts";
import { runRefresh } from "./cli/refresh.ts";
import { runRemove } from "./cli/remove.ts";
import { runAliasCmd } from "./commands/alias.ts";
import { runBind, runBinds, runUnbind } from "./commands/bind.ts";
import { runCompletionCmd } from "./commands/completion.ts";
import { runExtCmd } from "./commands/ext.ts";
import { runProfileCmd } from "./commands/profile.ts";
import { runUpdate } from "./commands/update.ts";
import { type ExtensionLoader, loadUserExtensions } from "./extension-loader.ts";
import { createRawInvocation } from "./pipeline/01-raw.ts";
import { parseInvocation, setGlobalOptionSpecs, setInternalVerbSet } from "./pipeline/02-parse.ts";
import { matchCommand } from "./pipeline/03-match-command.ts";
import { bindTarget } from "./pipeline/04-bind-target.ts";
import { resolveProfileStage } from "./pipeline/05-resolve-profile.ts";
import type { MatchedCommand, TargetInvocationHandle } from "./pipeline/types.ts";

const registry = createDefaultRegistry();
const abortSignal = new AbortController().signal;
const consoleLogger = {
  info: (msg: string) => process.stderr.write(`[clip] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[clip:warn] ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[clip:error] ${msg}\n`),
  debug: (msg: string) => {
    if (process.env.CLIP_EXT_TRACE === "1") process.stderr.write(`[clip:debug] ${msg}\n`);
  },
};

// ext loader는 main()에서 초기화 후 ext 커맨드에 전달
let _extLoader: ExtensionLoader | undefined;

type AclCheckTarget = {
  allow?: string[];
  deny?: string[];
  acl?: AclTree;
};

function registerBuiltinCommands(reg: Registry): void {
  const ext: ClipExtension = {
    name: "builtin:internal-commands",
    init(api) {
      api.options.registerGlobal({ name: "json-output", type: "boolean", aliases: ["json"], placement: "any" });
      api.options.registerGlobal({ name: "pipe", type: "boolean", placement: "any" });
      api.options.registerGlobal({ name: "dry-run", type: "boolean", placement: "any" });
      api.options.registerGlobal({ name: "debug", type: "boolean", placement: "any" });
      api.options.registerGlobal({ name: "format", type: "value", placement: "any", valueName: "format" });
      api.options.registerGlobal({
        name: "config",
        type: "value",
        aliases: ["c"],
        placement: "leading",
        valueName: "path",
      });
      api.options.registerGlobal({ name: "help", type: "boolean", aliases: ["h"], placement: "leading" });
      api.options.registerGlobal({ name: "version", type: "boolean", aliases: ["v"], placement: "leading" });

      api.commands.register({
        name: "config",
        async run({ args }) {
          await runConfigCmd(args, reg);
        },
      });
      api.commands.register({
        name: "list",
        async run() {
          await runList(reg, _extLoader?.phase1Commands);
        },
      });
      api.commands.register({
        name: "add",
        async run({ args }) {
          await runAdd(args, reg);
        },
      });
      api.commands.register({
        name: "remove",
        async run({ args }) {
          await runRemove(args);
        },
      });
      api.commands.register({
        name: "bind",
        async run({ args }) {
          await runBind(args);
        },
      });
      api.commands.register({
        name: "unbind",
        async run({ args }) {
          await runUnbind(args);
        },
      });
      api.commands.register({
        name: "binds",
        async run() {
          await runBinds();
        },
      });
      api.commands.register({
        name: "completion",
        async run({ args }) {
          await runCompletionCmd(args, reg, _extLoader?.phase1Commands);
        },
      });
      api.commands.register({
        name: "profile",
        async run({ args }) {
          await runProfileCmd(args);
        },
      });
      api.commands.register({
        name: "alias",
        async run({ args }) {
          await runAliasCmd(args);
        },
      });
      api.commands.register({
        name: "refresh",
        async run({ args }) {
          await runRefresh(args, reg);
        },
      });
      api.commands.register({
        name: "login",
        async run({ args }) {
          await runLogin(args, reg);
        },
      });
      api.commands.register({
        name: "logout",
        async run({ args }) {
          await runLogout(args);
        },
      });
      api.commands.register({
        name: "update",
        early: true,
        protected: true,
        options: [
          { name: "check", type: "boolean" },
          { name: "version", type: "value", valueName: "tag" },
          { name: "yes", type: "boolean", aliases: ["y"] },
          { name: "dry-run", type: "boolean" },
          { name: "force", type: "boolean" },
        ],
        async run({ args }) {
          await runUpdate(args);
        },
      });
      api.commands.register({
        name: "ext",
        async run({ args }) {
          await runExtCmd(args, reg);
        },
      });
    },
  };
  reg.register(ext);
}

registerBuiltinCommands(registry);

type CliRunState = {
  command?: CliCommandSummary;
  result?: TargetResult;
};

function exitCodeFromError(error: unknown): number {
  return error instanceof ClipError ? error.exitCode : 1;
}

function writeResult(result: TargetResult): void {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function findArgIndex(argv: readonly string[], token: string | undefined, fallback: number): number {
  if (!token) return fallback;
  const index = argv.indexOf(token);
  return index >= 0 ? index : fallback;
}

function flagName(arg: string): { name: string; value?: string } | null {
  if (!arg.startsWith("-")) return null;
  if (arg.startsWith("--")) {
    const raw = arg.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) return { name: raw.slice(0, eq), value: raw.slice(eq + 1) };
    return { name: raw };
  }
  return arg.length === 2 ? { name: arg.slice(1) } : null;
}

function parseRegisteredOptions(
  args: readonly string[],
  specs: readonly OptionSpec[] | undefined,
): Record<string, OptionValue> {
  if (!specs?.length) return {};
  const byName = new Map<string, OptionSpec>();
  for (const spec of specs) {
    byName.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) byName.set(alias, spec);
  }

  const out: Record<string, OptionValue> = {};
  for (let i = 0; i < args.length; i++) {
    const parsed = flagName(args[i] ?? "");
    if (!parsed) continue;
    const spec = byName.get(parsed.name);
    if (!spec) continue;
    if (spec.type === "boolean") {
      out[spec.name] = true;
    } else {
      const value = parsed.value ?? args[i + 1];
      if (value !== undefined) {
        out[spec.name] = value;
        if (parsed.value === undefined) i++;
      }
    }
  }
  return out;
}

function splitEarlyInternalCommand(argv: readonly string[]): { verb: string; args: string[] } | null {
  const valueFlags = new Set(["--config", "-c", "--format"]);
  const skipFlags = new Set(["--json", "--json-output", "--pipe", "--dry-run", "--debug"]);
  const args = [...argv];
  const leadingArgs: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i] ?? "";
    if (valueFlags.has(arg)) {
      i += 2;
      continue;
    }
    if (skipFlags.has(arg)) {
      if (arg === "--dry-run") leadingArgs.push(arg);
      if (arg === "--debug") process.env.CLIP_EXT_TRACE = "1";
      i++;
      continue;
    }
    break;
  }

  const verb = args[i];
  if (verb !== "update") return null;
  return { verb, args: [...leadingArgs, ...args.slice(i + 1)] };
}

async function main(): Promise<number> {
  const rawArgv = Bun.argv.slice(2);
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  const state: CliRunState = {};
  let exitCode = 1;
  let thrown: unknown;

  const earlyCommand = splitEarlyInternalCommand(rawArgv);
  if (earlyCommand?.verb === "update") {
    await runUpdate(earlyCommand.args);
    return 0;
  }

  // argv를 Phase 1 완료 후 loader에 전달 — hooks 없는 extension은 argv 매칭 시만 Phase 2 실행
  _extLoader = await loadUserExtensions(registry, rawArgv);
  await registry.initAll();
  setGlobalOptionSpecs(registry.listGlobalOptions());

  await registry.runHooks("command-start", { phase: "command-start", argv: rawArgv, startedAt });

  try {
    exitCode = await runMain(rawArgv, state);
    return exitCode;
  } catch (error) {
    thrown = error;
    exitCode = exitCodeFromError(error);
    throw error;
  } finally {
    await registry
      .runHooks("command-end", {
        phase: "command-end",
        argv: rawArgv,
        startedAt,
        durationMs: Math.max(0, Math.round(performance.now() - startedMs)),
        exitCode,
        ...(state.command ? { command: state.command } : {}),
        ...(state.result ? { result: state.result } : {}),
        ...(thrown ? { error: thrown } : {}),
      })
      .catch((error) => {
        if (process.env.CLIP_EXT_TRACE === "1")
          process.stderr.write(`[clip:debug] command-end hook failed: ${error}\n`);
      });
  }
}

async function runMain(rawArgv: string[], state: CliRunState): Promise<number> {
  // builtin + user(Phase 1 선언) internal verbs를 모두 포함해 parseInvocation이 올바르게 분류하도록 한다.
  // Phase 2 init이 안 된 user verb도 포함: handler 없으면 "unknown command" 출력 (main.ts:matched.kind==="internal" 분기).
  const allVerbs = new Set([...registry.listCommandNames(), ...(_extLoader?.phase1Commands ?? [])]);
  setInternalVerbSet(allVerbs);

  process.on("SIGINT", () => {
    registry.disposeAll().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    registry.disposeAll().finally(() => process.exit(0));
  });

  const argv = rawArgv;
  const raw = createRawInvocation(argv, process.env);
  const parsed = parseInvocation(raw);

  if ((parsed as unknown as { internalVerb: string | undefined }).internalVerb === "version") {
    state.command = { kind: "version", argv: rawArgv };
    console.log(`clip ${VERSION}`);
    return 0;
  }

  const matched: MatchedCommand = matchCommand(parsed);

  if (matched.kind === "help") {
    state.command = { kind: "help", argv: rawArgv };
    console.log(HELP);
    return 0;
  }

  if (matched.kind === "internal") {
    state.command = { kind: "command", argv: rawArgv, name: matched.verb, args: matched.rest };
    const handler = registry.getCommandHandler(matched.verb);
    if (!handler) {
      process.stderr.write(`clip: unknown command "${matched.verb}"\n`);
      return 1;
    }
    const commandSpec = registry.getCommand(matched.verb);
    const startCtx = {
      phase: "subcommand-start" as const,
      kind: "command" as const,
      command: matched.verb,
      subcommand: matched.verb,
      subcommandIndex: findArgIndex(rawArgv, matched.verb, 0),
      args: matched.rest,
      globalOptions: parsed.lateFlags.options,
      targetName: "",
      targetType: "",
      target: Object.freeze({}),
      headers: {},
      dryRun: parsed.lateFlags.dryRun,
      jsonMode: parsed.lateFlags.jsonMode,
      passthrough: false,
    };
    const beforeResult = await registry.runHooks("subcommand-start", startCtx);
    if (beforeResult && "shortCircuit" in beforeResult) {
      state.result = beforeResult.shortCircuit;
      writeResult(beforeResult.shortCircuit);
      return beforeResult.shortCircuit.exitCode;
    }
    const effectiveArgs =
      beforeResult && "args" in beforeResult && beforeResult.args !== undefined
        ? beforeResult.args
        : (matched.rest as string[]);
    await handler({
      args: effectiveArgs,
      options: parseRegisteredOptions(effectiveArgs, commandSpec?.options),
      globalOptions: parsed.lateFlags.options,
      argv: rawArgv,
      logger: consoleLogger,
      signal: abortSignal,
    });
    const result = { exitCode: 0, stdout: "", stderr: "" };
    const afterResult = await registry.runHooks("subcommand-end", {
      ...startCtx,
      phase: "subcommand-end",
      args: effectiveArgs,
      result,
    });
    if (afterResult && "result" in afterResult) {
      state.result = { ...result, ...afterResult.result };
      writeResult(state.result);
    }
    return 0;
  }

  if (matched.kind !== "target") {
    state.command = { kind: "none", argv: rawArgv };
    return 0;
  }
  const { invocation } = matched;
  const { baseName, subcommand: rawSubcommand, targetArgs } = invocation;
  const { jsonMode, pipeMode, dryRun } = invocation.lateFlags;

  const config = await loadConfig(registry);

  // Phase 2 (type-matched): config에서 target type을 조회해 bindTarget() 이전에 user extension을 lazy init.
  // getTarget()은 die()를 호출할 수 있으나, bindTarget()에서도 동일한 조회를 하므로 중복 오류는 발생하지 않는다.
  if (_extLoader) {
    try {
      const { type: targetType } = getTarget(config, invocation.baseName);
      await _extLoader.initMatchingType(targetType, registry);
    } catch {
      // target not found — bindTarget()에서 올바른 오류 메시지로 처리됨
    }
  }

  const bound = bindTarget(invocation, config, registry);
  const mergedResult = resolveProfileStage(bound, registry);
  const { type, target } = mergedResult as unknown as {
    type: string;
    target: unknown;
    invocation: TargetInvocationHandle;
  };
  state.command = {
    kind: "target",
    argv: rawArgv,
    token: invocation.token,
    target: baseName,
    targetType: type,
    ...(invocation.explicitProfile !== undefined ? { profile: invocation.explicitProfile } : {}),
    ...(rawSubcommand !== undefined ? { subcommand: rawSubcommand } : {}),
    args: [...targetArgs],
    dryRun,
    jsonMode,
    pipeMode,
    ...(invocation.lateFlags.format !== undefined ? { format: invocation.lateFlags.format } : {}),
  };

  if (!rawSubcommand || rawSubcommand === "--help" || rawSubcommand === "-h") {
    await printTargetHelp(baseName, type, target, registry);
    return 0;
  }

  const lateFiltered = [...targetArgs] as string[];
  const effectiveDryRun = dryRun;
  const effectiveJsonMode = jsonMode;
  const effectivePipeMode = pipeMode;
  const supportsPassthrough = registry.getArgSpec(type)?.passthrough ?? false;
  const effectivePassthrough =
    supportsPassthrough && !!process.stdout.isTTY && !effectiveJsonMode && !effectivePipeMode;

  const hasHelpFlag = lateFiltered.includes("--help") || lateFiltered.includes("-h");
  if (hasHelpFlag && rawSubcommand !== "tools") {
    checkAcl(target as AclCheckTarget, rawSubcommand, undefined, baseName);

    const aliasDef = (target as HasAliases).aliases?.[rawSubcommand];
    if (aliasDef) {
      const lines = [`Alias: ${rawSubcommand}  →  ${aliasDef.subcommand}`];
      if (aliasDef.args?.length) lines.push(`  args:   ${aliasDef.args.join(" ")}`);
      if (aliasDef.input) lines.push(`  input:  ${JSON.stringify(aliasDef.input)}`);
      if (aliasDef.description) lines.push(`  desc:   ${aliasDef.description}`);
      console.log(lines.join("\n"));
      return 0;
    }

    const def = registry.getTargetType(type);
    if (def?.describeTools) {
      const helpHookCtx = {
        phase: "subcommand-start" as const,
        kind: "target" as const,
        command: baseName,
        targetName: baseName,
        targetType: type,
        target: Object.freeze(target),
        subcommand: rawSubcommand,
        subcommandIndex: findArgIndex(rawArgv, rawSubcommand, 1),
        args: lateFiltered.filter((a) => a !== "--help" && a !== "-h"),
        globalOptions: invocation.lateFlags.options,
        headers: config.headers ?? {},
        dryRun: effectiveDryRun,
        jsonMode: effectiveJsonMode,
        passthrough: false,
      };
      const beforeResult = await registry.runHooks("subcommand-start", helpHookCtx);
      const helpHeaders =
        beforeResult && "headers" in beforeResult && beforeResult.headers
          ? { ...(config.headers ?? {}), ...beforeResult.headers }
          : (config.headers ?? {});

      const tools = await def.describeTools(target, { targetName: baseName, headers: helpHeaders });
      if (tools !== null) {
        const tool = tools.find((t) => t.name === rawSubcommand);
        if (tool) {
          const r = formatToolHelp(tool);
          state.result = r;
          process.stdout.write(r.stdout);
          return r.exitCode;
        }
        process.stderr.write(`Tool "${rawSubcommand}" not found. Run: clip ${baseName} tools\n`);
        return 1;
      }
    }
  }

  const result = await dispatch(
    config,
    {
      targetName: baseName,
      resolvedTarget: { type, target } as ResolvedTarget,
      subcommand: rawSubcommand,
      args: lateFiltered,
      headers: config.headers ?? {},
      dryRun: effectiveDryRun,
      jsonMode: effectiveJsonMode,
      passthrough: effectivePassthrough && !effectiveDryRun,
      env: process.env as Record<string, string>,
      globalOptions: invocation.lateFlags.options,
      argv: rawArgv,
      subcommandIndex: findArgIndex(rawArgv, rawSubcommand, 1),
    },
    registry,
  );

  const shouldPassthrough = effectivePassthrough && !effectiveDryRun;
  state.command = {
    ...(state.command as Extract<CliCommandSummary, { kind: "target" }>),
    passthrough: shouldPassthrough,
  };
  state.result = result;
  if (shouldPassthrough) {
    return result.exitCode;
  }

  const lateFlags = invocation.lateFlags;
  const format = lateFlags.format ?? (effectiveJsonMode ? "json" : "plain");
  const meta = { target: invocation.token, durationMs: 0, format };
  await outputRegistry.render(result, type, meta, format);
  return result.exitCode;
}

main()
  .then((code) => registry.disposeAll().finally(() => process.exit(code ?? 0)))
  .catch(printAndExit);
