#!/usr/bin/env bun
import { createDefaultRegistry } from "./builtin-loader.ts";
import { runAdd } from "./cli/add.ts";
import { runConfigCmd } from "./cli/config-cmd.ts";
import { HELP, printTargetHelp } from "./cli/help.ts";
import { runList } from "./cli/list.ts";
import { runLogin, runLogout } from "./cli/login.ts";
import { parseGlobalFlags } from "./cli/parser.ts";
import { runRefresh } from "./cli/refresh.ts";
import { runRemove } from "./cli/remove.ts";
import { type HasAliases, runAliasCmd } from "./commands/alias.ts";
import { runBind, runBinds, runUnbind } from "./commands/bind.ts";
import { runCompletionCmd } from "./commands/completion.ts";
import { resolveProfile, runProfileCmd } from "./commands/profile.ts";
import { runSkillsCmd } from "./commands/skills.ts";
import { getTarget, loadConfig } from "./config.ts";
import { dispatch } from "./dispatch.ts";
import { loadUserExtensions } from "./extension-loader.ts";
import { printAndExit } from "./utils/errors.ts";
import { formatOutput } from "./utils/output.ts";
import { formatToolHelp } from "./utils/tool-args.ts";

const registry = createDefaultRegistry();

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
  const { jsonMode, pipeMode, dryRun, rest } = parseGlobalFlags(argv);

  if (rest.length === 0) {
    console.log(HELP);
    return 0;
  }

  const targetName = rest[0]!;

  if (targetName === "config") {
    await runConfigCmd(rest.slice(1));
    return 0;
  }
  if (targetName === "list") {
    await runList();
    return 0;
  }
  if (targetName === "add") {
    await runAdd(rest.slice(1));
    return 0;
  }
  if (targetName === "remove") {
    await runRemove(rest.slice(1));
    return 0;
  }
  if (targetName === "skills") {
    await runSkillsCmd(rest.slice(1));
    return 0;
  }
  if (targetName === "bind") {
    await runBind(rest.slice(1));
    return 0;
  }
  if (targetName === "unbind") {
    await runUnbind(rest.slice(1));
    return 0;
  }
  if (targetName === "binds") {
    await runBinds();
    return 0;
  }
  if (targetName === "completion") {
    await runCompletionCmd(rest.slice(1));
    return 0;
  }
  if (targetName === "profile") {
    await runProfileCmd(rest.slice(1));
    return 0;
  }
  if (targetName === "alias") {
    await runAliasCmd(rest.slice(1));
    return 0;
  }
  if (targetName === "refresh") {
    await runRefresh(rest.slice(1), registry);
    return 0;
  }
  if (targetName === "login") {
    await runLogin(rest.slice(1));
    return 0;
  }
  if (targetName === "logout") {
    await runLogout(rest.slice(1));
    return 0;
  }

  // <target>@<profile> 파싱
  const atIdx = targetName.indexOf("@");
  const baseName = atIdx >= 0 ? targetName.slice(0, atIdx) : targetName;
  const explicitProfile = atIdx >= 0 ? targetName.slice(atIdx + 1) : undefined;

  const config = await loadConfig();
  const resolved = getTarget(config, baseName);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { merged: mergedTarget } = resolveProfile(resolved.target as any, explicitProfile);
  const { type } = resolved;
  const target = mergedTarget;

  let rawSubcommand = rest[1];
  let rawTargetArgsBase = rest.slice(2);

  // clip <target> --help <tool> → treat --help as a flag, use next positional as subcommand
  if ((rawSubcommand === "--help" || rawSubcommand === "-h") && rest[2] && !rest[2].startsWith("-")) {
    rawSubcommand = rest[2];
    rawTargetArgsBase = ["--help", ...rest.slice(3)];
  }

  if (!rawSubcommand || rawSubcommand === "--help" || rawSubcommand === "-h") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await printTargetHelp(baseName, type as any, target);
    return 0;
  }

  const rawTargetArgs = rawTargetArgsBase;
  const LATE_FLAGS = new Set(["--dry-run", "--json", "--pipe", "--debug"]);
  const effectiveDryRun = dryRun || rawTargetArgs.includes("--dry-run");
  if (rawTargetArgs.includes("--debug")) process.env["CLIP_EXT_TRACE"] = "1";
  const effectiveJsonMode = jsonMode || rawTargetArgs.includes("--json");
  const effectivePipeMode = pipeMode || rawTargetArgs.includes("--pipe");
  const effectivePassthrough = !!process.stdout.isTTY && !effectiveJsonMode && !effectivePipeMode;
  const lateFiltered = rawTargetArgs.filter((a) => !LATE_FLAGS.has(a));

  const hasHelpFlag = lateFiltered.includes("--help") || lateFiltered.includes("-h");
  if (hasHelpFlag && rawSubcommand !== "tools") {
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
      const tools = await def.describeTools(target, { targetName: baseName });
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
      targetName,
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
