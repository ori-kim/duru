#!/usr/bin/env bun
/**
 * apps/clip/src/main.ts — 모노레포 조립 entry
 *
 * builtin-loader.ts의 createDefaultRegistry()를 사용해 registry를 생성한다.
 * 특정 extension을 제거하려면 builtin-loader.ts의 BUILTIN_EXTENSIONS 배열에서 관리한다.
 *
 * 현재 단계: 기존 src/ 구조를 그대로 참조.
 * 이후 단계에서 각 extension이 packages/extensions/* 로 이동하면 import 경로를 업데이트한다.
 */
import { checkAcl } from "../../../src/acl.ts";
import { createDefaultRegistry } from "../../../src/builtin-loader.ts";
import { runAdd } from "../../../src/cli/add.ts";
import { runConfigCmd } from "../../../src/cli/config-cmd.ts";
import { HELP, VERSION, printTargetHelp } from "../../../src/cli/help.ts";
import { runList } from "../../../src/cli/list.ts";
import { runLogin, runLogout } from "../../../src/cli/login.ts";
import { runRefresh } from "../../../src/cli/refresh.ts";
import { runRemove } from "../../../src/cli/remove.ts";
import { type HasAliases, runAliasCmd } from "../../../src/commands/alias.ts";
import { runBind, runBinds, runUnbind } from "../../../src/commands/bind.ts";
import { runCompletionCmd } from "../../../src/commands/completion.ts";
import { runProfileCmd } from "../../../src/commands/profile.ts";
import { runSkillsCmd } from "../../../src/commands/skills.ts";
import { runWorkspaceCmd } from "../../../src/commands/workspace.ts";
import { loadConfig } from "../../../src/config.ts";
import { dispatch } from "../../../src/dispatch.ts";
import { type ClipExtension, Registry } from "../../../src/extension.ts";
import { loadUserExtensions } from "../../../src/extension-loader.ts";
import { createRawInvocation } from "../../../src/pipeline/01-raw.ts";
import { parseInvocation, setInternalVerbSet } from "../../../src/pipeline/02-parse.ts";
import { matchCommand } from "../../../src/pipeline/03-match-command.ts";
import { bindTarget } from "../../../src/pipeline/04-bind-target.ts";
import { resolveProfileStage } from "../../../src/pipeline/05-resolve-profile.ts";
import type { MatchedCommand, TargetInvocationHandle } from "../../../src/pipeline/types.ts";
import { outputRegistry } from "../../../src/output-registry.ts";
import { printAndExit } from "../../../src/utils/errors.ts";
import { formatToolHelp } from "../../../src/utils/tool-args.ts";

const registry = createDefaultRegistry();

function registerInternalCommands(reg: Registry): void {
  const ext: ClipExtension = {
    name: "builtin:internal-commands",
    init(api) {
      api.registerInternalCommand("config",     async ({ args }) => { await runConfigCmd(args, reg); });
      api.registerInternalCommand("list",       async () => { await runList(reg); });
      api.registerInternalCommand("add",        async ({ args }) => { await runAdd(args, reg); });
      api.registerInternalCommand("remove",     async ({ args }) => { await runRemove(args); });
      api.registerInternalCommand("skills",     async ({ args }) => { await runSkillsCmd(args); });
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
    },
  };
  reg.register(ext);
}

registerInternalCommands(registry);

async function main(): Promise<number> {
  await loadUserExtensions(registry);
  await registry.initAll();

  setInternalVerbSet(new Set(registry.listInternalVerbs()));

  process.on("SIGINT", () => {
    registry.disposeAll().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    registry.disposeAll().finally(() => process.exit(0));
  });

  const argv = Bun.argv.slice(2);
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

  const config = await loadConfig();
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
      resolvedTarget: { type, target } as import("../../../src/config.ts").ResolvedTarget,
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
