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
import { checkAcl, dispatch, loadConfig, getTarget, outputRegistry, printAndExit, formatToolHelp } from "@clip/core";
import type { ClipExtension, HasAliases, ResolvedTarget } from "@clip/core";
import { Registry } from "@clip/core";
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
import { runWorkspaceCmd } from "./commands/workspace.ts";
import { loadUserExtensions, type ExtensionLoader } from "./extension-loader.ts";
import { createRawInvocation } from "./pipeline/01-raw.ts";
import { parseInvocation, setInternalVerbSet } from "./pipeline/02-parse.ts";
import { matchCommand } from "./pipeline/03-match-command.ts";
import { bindTarget } from "./pipeline/04-bind-target.ts";
import { resolveProfileStage } from "./pipeline/05-resolve-profile.ts";
import type { MatchedCommand, TargetInvocationHandle } from "./pipeline/types.ts";

const registry = createDefaultRegistry();

// ext loader는 main()에서 초기화 후 ext 커맨드에 전달
let _extLoader: ExtensionLoader | undefined;

function registerInternalCommands(reg: Registry): void {
  const ext: ClipExtension = {
    name: "builtin:internal-commands",
    init(api) {
      api.registerInternalCommand("config",     async ({ args }) => { await runConfigCmd(args, reg); });
      api.registerInternalCommand("list",       async () => { await runList(reg); });
      api.registerInternalCommand("add",        async ({ args }) => { await runAdd(args, reg); });
      api.registerInternalCommand("remove",     async ({ args }) => { await runRemove(args); });
      api.registerInternalCommand("bind",       async ({ args }) => { await runBind(args); });
      api.registerInternalCommand("unbind",     async ({ args }) => { await runUnbind(args); });
      api.registerInternalCommand("binds",      async () => { await runBinds(); });
      api.registerInternalCommand("completion", async ({ args }) => { await runCompletionCmd(args, reg); });
      api.registerInternalCommand("profile",    async ({ args }) => { await runProfileCmd(args); });
      api.registerInternalCommand("alias",      async ({ args }) => { await runAliasCmd(args); });
      api.registerInternalCommand("refresh",    async ({ args }) => { await runRefresh(args, reg); });
      api.registerInternalCommand("login",      async ({ args }) => { await runLogin(args, reg); });
      api.registerInternalCommand("logout",     async ({ args }) => { await runLogout(args); });
      api.registerInternalCommand("workspace",  async ({ args }) => { await runWorkspaceCmd(args); });
      api.registerInternalCommand("ext",        async ({ args }) => { await runExtCmd(args); });
    },
  };
  reg.register(ext);
}

registerInternalCommands(registry);

async function main(): Promise<number> {
  // argv를 Phase 1 완료 후 loader에 전달 — hooks 없는 extension은 argv 매칭 시만 Phase 2 실행
  const rawArgv = Bun.argv.slice(2);
  _extLoader = await loadUserExtensions(registry, rawArgv);
  await registry.initAll();

  // builtin + user(Phase 1 선언) internal verbs를 모두 포함해 parseInvocation이 올바르게 분류하도록 한다.
  // Phase 2 init이 안 된 user verb도 포함: handler 없으면 "unknown command" 출력 (main.ts:matched.kind==="internal" 분기).
  const allVerbs = new Set([
    ...registry.listInternalVerbs(),
    ...(_extLoader?.phase1InternalVerbs ?? []),
  ]);
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
    console.log(`clip ${VERSION}`);
    return 0;
  }

  const matched: MatchedCommand = matchCommand(parsed);

  if (matched.kind === "help") {
    console.log(HELP);
    return 0;
  }

  if (matched.kind === "internal") {
    const handler = registry.getInternalCommand(matched.verb);
    if (!handler) {
      process.stderr.write(`clip: unknown command "${matched.verb}"\n`);
      return 1;
    }
    await handler({ args: matched.rest as string[] });
    return 0;
  }

  if (matched.kind !== "target") return 0;
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
  const { type, target } = mergedResult as unknown as { type: string; target: unknown; invocation: TargetInvocationHandle };

  if (!rawSubcommand || rawSubcommand === "--help" || rawSubcommand === "-h") {
    await printTargetHelp(baseName, type, target, registry);
    return 0;
  }

  const lateFiltered = [...targetArgs] as string[];
  const effectiveDryRun = dryRun;
  const effectiveJsonMode = jsonMode;
  const effectivePipeMode = pipeMode;
  const effectivePassthrough = !!process.stdout.isTTY && !effectiveJsonMode && !effectivePipeMode;

  const hasHelpFlag = lateFiltered.includes("--help") || lateFiltered.includes("-h");
  if (hasHelpFlag && rawSubcommand !== "tools") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkAcl(target as any, rawSubcommand, undefined, baseName);

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
        phase: "beforeExecute" as const,
        targetName: baseName,
        targetType: type,
        target: Object.freeze(target),
        subcommand: rawSubcommand,
        args: lateFiltered.filter((a) => a !== "--help" && a !== "-h"),
        headers: config.headers ?? {},
        dryRun: effectiveDryRun,
        jsonMode: effectiveJsonMode,
        passthrough: false,
      };
      const beforeResult = await registry.runHooks("beforeExecute", helpHookCtx);
      const helpHeaders =
        beforeResult && "headers" in beforeResult && beforeResult.headers
          ? { ...(config.headers ?? {}), ...beforeResult.headers }
          : (config.headers ?? {});

      const tools = await def.describeTools(target, { targetName: baseName, headers: helpHeaders });
      if (tools !== null) {
        const tool = tools.find((t) => t.name === rawSubcommand);
        if (tool) {
          const r = formatToolHelp(tool);
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
      targetName: invocation.token,
      resolvedTarget: { type, target } as ResolvedTarget,
      subcommand: rawSubcommand,
      args: lateFiltered,
      headers: config.headers ?? {},
      dryRun: effectiveDryRun,
      jsonMode: effectiveJsonMode,
      passthrough: effectivePassthrough && !effectiveDryRun,
      env: process.env as Record<string, string>,
    },
    registry,
  );

  const shouldPassthrough = effectivePassthrough && !effectiveDryRun;
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
