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
import { loadUserExtensions } from "./extension-loader.ts";
import { createRawInvocation } from "./pipeline/01-raw.ts";
import { parseInvocation } from "./pipeline/02-parse.ts";
import { matchCommand } from "./pipeline/03-match-command.ts";
import { bindTarget } from "./pipeline/04-bind-target.ts";
import { resolveProfileStage } from "./pipeline/05-resolve-profile.ts";
import type { InternalVerb, MatchedCommand, TargetInvocationHandle } from "./pipeline/types.ts";
import { printAndExit } from "./utils/errors.ts";
import { formatOutput } from "./utils/output.ts";
import { formatToolHelp } from "./utils/tool-args.ts";

const registry = createDefaultRegistry();

async function runInternal(verb: InternalVerb, rest: readonly string[], reg: typeof registry): Promise<number> {
  const args = rest as string[];
  switch (verb) {
    case "config": await runConfigCmd(args); return 0;
    case "list": await runList(); return 0;
    case "add": await runAdd(args); return 0;
    case "remove": await runRemove(args); return 0;
    case "skills": await runSkillsCmd(args); return 0;
    case "bind": await runBind(args); return 0;
    case "unbind": await runUnbind(args); return 0;
    case "binds": await runBinds(); return 0;
    case "completion": await runCompletionCmd(args); return 0;
    case "profile": await runProfileCmd(args); return 0;
    case "alias": await runAliasCmd(args); return 0;
    case "refresh": await runRefresh(args, reg); return 0;
    case "login": await runLogin(args); return 0;
    case "logout": await runLogout(args); return 0;
    case "workspace": await runWorkspaceCmd(args); return 0;
  }
}

async function main(): Promise<number> {
  await loadUserExtensions(registry);
  await registry.initAll();
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
    return runInternal(matched.verb, matched.rest, registry);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await printTargetHelp(baseName, type as any, target as any);
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
