import { existsSync, statSync } from "fs";
import { buildAliasSection } from "../../commands/alias.ts";
import type { HasAliases } from "../../commands/alias.ts";
import type { TargetResult } from "../../extension.ts";
import type { ExecutorContext } from "../../extension.ts";
import { die } from "../../utils/errors.ts";
import type { ScriptCommandDef, ScriptTarget } from "./schema.ts";

function buildToolsOutput(target: ScriptTarget): string {
  const cmds = Object.entries(target.commands ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const lines: string[] = [];
  if (cmds.length === 0) {
    lines.push("No commands defined.");
  } else {
    lines.push("Commands:");
    for (const [name, def] of cmds) {
      const argList = def.args?.length ? ` <${def.args.join("> <")}>` : "";
      const source = def.file ? ` [file]` : "";
      const desc = def.description ? `  — ${def.description}` : "";
      lines.push(`  ${name.padEnd(20)}${argList}${source}${desc}`);
    }
  }
  const aliasSection = buildAliasSection(target as HasAliases);
  return aliasSection ? `${lines.join("\n")}\n${aliasSection}` : lines.join("\n");
}

function buildCommandHelp(name: string, def: ScriptCommandDef): string {
  const lines = [`Command: ${name}`];
  if (def.description) lines.push(`  ${def.description}`);
  if (def.args?.length) {
    lines.push(`  Usage: clip <target> ${name} ${def.args.map((a) => `<${a}>`).join(" ")}`);
  }
  if (def.file) {
    lines.push("", `File: ${def.file}`);
  } else if (def.script) {
    lines.push(
      "",
      "Script:",
      def.script
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }
  return lines.join("\n");
}

function buildSpawnArgs(subcommand: string, def: ScriptCommandDef, userArgs: string[]): string[] {
  if (def.file) {
    if (!existsSync(def.file)) {
      die(`Script file not found: ${def.file}`);
    }
    const st = statSync(def.file);
    if (!(st.mode & 0o111)) {
      die(`Script file is not executable: ${def.file}\n  hint: chmod +x "${def.file}"`);
    }
    return [def.file, ...userArgs];
  }
  return ["bash", "-c", def.script!, `clip-${subcommand}`, ...userArgs];
}

export async function executeScript(target: ScriptTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { subcommand, args, dryRun, passthrough } = ctx;
  if (subcommand === "tools") {
    return { exitCode: 0, stdout: buildToolsOutput(target) + "\n", stderr: "" };
  }

  const def = target.commands?.[subcommand];
  if (!def) die(`Unknown command "${subcommand}". Run: clip <target> tools`);

  if (args.includes("--help") || args.includes("-h")) {
    return { exitCode: 0, stdout: buildCommandHelp(subcommand, def) + "\n", stderr: "" };
  }

  const env = { ...process.env, ...(target.env ?? {}), ...(def.env ?? {}) } as Record<string, string>;

  if (dryRun) {
    const preview = def.file ? `# file: ${def.file}\n` : `# script:\n${def.script}\n`;
    return { exitCode: 0, stdout: `${preview}# args: ${JSON.stringify(args)}\n`, stderr: "" };
  }

  const cmd = buildSpawnArgs(subcommand, def, args);

  if (passthrough) {
    const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env });
    return { exitCode: await proc.exited, stdout: "", stderr: "" };
  }

  const proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "pipe", stderr: "pipe", env });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
  const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
  return { exitCode, stdout, stderr };
}

