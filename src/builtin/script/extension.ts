import type { ClipExtension, NormalizeCtx } from "../../extension.ts";
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
  },
};
