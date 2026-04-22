import { addTarget } from "../../config.ts";
import type { AddArgs, ClipExtension, ListOpts, NormalizeCtx } from "../../extension.ts";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { executeScript } from "./executor.ts";
import { type ScriptTarget, scriptTargetSchema } from "./schema.ts";

function resolveScriptPath(file: string, baseDir: string): string {
  if (file.startsWith("~/") || file === "~") {
    return join(homedir(), file.slice(1));
  }
  if (isAbsolute(file)) return file;
  return resolve(baseDir, file);
}

function normalizeScript(t: ScriptTarget, ctx: NormalizeCtx): ScriptTarget {
  const resolvedCommands: ScriptTarget["commands"] = {};
  for (const [cmd, def] of Object.entries(t.commands)) {
    resolvedCommands[cmd] = def.file ? { ...def, file: resolveScriptPath(def.file, ctx.configDir) } : def;
  }
  return { ...t, commands: resolvedCommands };
}

export const extension: ClipExtension = {
  name: "builtin:script",
  init(api) {
    api.registerTargetType({
      type: "script",
      schema: scriptTargetSchema,
      executor: executeScript,
      normalizeConfig: (parsed, ctx) => normalizeScript(parsed as ScriptTarget, ctx),
    });
    api.registerResultPresenter({
      type: "script",
      toViewModel(result, meta) {
        return { kind: "call-result", content: result, meta };
      },
    });
    api.registerContribution({
      type: "script",
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as ScriptTarget;
        const { color, wsTag, bind } = opts;
        const nm = color("38;5;245", name.padEnd(16));
        const commands = t.commands as Record<string, unknown> | undefined;
        const cmdCount = Object.keys(commands ?? {}).length;
        const desc = t.description ? ` — ${t.description}` : "";
        const aclStr = formatAcl(t as Record<string, unknown>);
        return `  ${nm} ${cmdCount} command(s)${desc}${aclStr}${bind(name)}${wsTag(name)}`;
      },
      urlHeuristic: () => false,
      addHandler: async (args: AddArgs) => {
        const { name, flags, allow, deny, addOpts } = args;
        const description = flags["description"];
        await addTarget(name, "script", {
          ...(description ? { description } : {}),
          commands: {},
          allow,
          deny,
        }, addOpts);
        console.log(`Added script target "${name}".`);
      },
      helpRenderer: async (_name, target) => {
        const t = target as ScriptTarget;
        const cmdCount = Object.keys(t.commands ?? {}).length;
        return t.description ? `Script: ${t.description}` : `Script target (${cmdCount} commands)`;
      },
    });
  },
};

function formatAcl(target: Record<string, unknown>): string {
  const allow = target["allow"] as string[] | undefined;
  const deny = target["deny"] as string[] | undefined;
  const acl = target["acl"] as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (allow && allow.length > 0) parts.push(`allow: ${allow.join(",")}`);
  if (deny && deny.length > 0) parts.push(`deny: ${deny.join(",")}`);
  if (acl) parts.push(`acl: [${Object.keys(acl).join(",")}]`);
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}
