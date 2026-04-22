#!/usr/bin/env bun
import { checkAcl } from "./acl.ts";
import { createDefaultRegistry } from "./builtin-loader.ts";
import { runAdd } from "./cli/add.ts";
import { runConfigCmd } from "./cli/config-cmd.ts";
import { HELP, VERSION, printTargetHelp } from "./cli/help.ts";
import { runList } from "./cli/list.ts";
import { runLogin, runLogout } from "./cli/login.ts";
import { runRefresh } from "./cli/refresh.ts";
import { runRemove } from "./cli/remove.ts";
import { type HasAliases, runAliasCmd } from "./commands/alias.ts";
import { runBind, runBinds, runUnbind } from "./commands/bind.ts";
import { runCompletionCmd } from "./commands/completion.ts";
import { runProfileCmd } from "./commands/profile.ts";
import { runSkillsCmd } from "./commands/skills.ts";
import { runWorkspaceCmd } from "./commands/workspace.ts";
import { loadConfig } from "./config.ts";
import { dispatch } from "./dispatch.ts";
import { type ClipExtension, Registry } from "./extension.ts";
import { loadUserExtensions } from "./extension-loader.ts";
import { createRawInvocation } from "./pipeline/01-raw.ts";
import { parseInvocation, setInternalVerbSet } from "./pipeline/02-parse.ts";
import { matchCommand } from "./pipeline/03-match-command.ts";
import { bindTarget } from "./pipeline/04-bind-target.ts";
import { resolveProfileStage } from "./pipeline/05-resolve-profile.ts";
import type { MatchedCommand, TargetInvocationHandle } from "./pipeline/types.ts";
import { printAndExit } from "./utils/errors.ts";
import { formatOutput } from "./utils/output.ts";
import { formatToolHelp } from "./utils/tool-args.ts";

const registry = createDefaultRegistry();

// internal commands를 extension으로 등록한다.
// cli/* 파일들이 config.ts → builtin-loader.ts 순환을 피하기 위해 clip.ts에서 직접 등록.
function registerInternalCommands(reg: Registry): void {
  const ext: ClipExtension = {
    name: "builtin:internal-commands",
    init(api) {
      api.registerInternalCommand("config",     async ({ args }) => { await runConfigCmd(args); });
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

  // parse 단계에서 internal verb를 판별할 수 있도록 registry에 등록된 verb 세트를 주입한다.
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

  // kind === "target" (completion은 internal verb로 처리되므로 여기 도달하지 않음)
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
    // ACL은 help 여부와 무관하게 항상 적용
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
      // beforeExecute 훅을 실행해 auth 헤더 등을 주입받은 뒤 describeTools에 전달
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
      // null = cache miss (mcp) → executor 경로로 fallback (executor 내부 --help 처리)
    }
    // describeTools 미구현(cli 등) → executor로 fallback
  }

  const result = await dispatch(
    config,
    {
      targetName: invocation.token,
      resolvedTarget: { type, target } as import("./config.ts").ResolvedTarget,
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
  const jMode = type === "graphql" ? jsonMode : effectiveJsonMode;
  return formatOutput(result, jMode ? "json" : "plain");
}

main()
  .then((code) => registry.disposeAll().finally(() => process.exit(code ?? 0)))
  .catch(printAndExit);
