import type { AliasDef } from "./utils/target-schema.ts";

export type { AliasDef };

// --- Types ---

export type HasAliases = {
  aliases?: Record<string, AliasDef>;
};

// --- Placeholder engine ---

function expandToken(token: string, userArgs: string[], env: Record<string, string>): string[] {
  if (token === "$@") return [...userArgs];
  if (token === "$*") return [userArgs.join(" ")];
  const result = token.replace(/\$(\$|[1-9]|\{([^}]+)\})/g, (_, inner: string, varName: string | undefined) => {
    if (inner === "$") return "$";
    if (varName !== undefined) return env[varName] ?? process.env[varName] ?? "";
    const idx = Number.parseInt(inner, 10);
    return userArgs[idx - 1] ?? "";
  });
  return [result];
}

function hasUserArgPlaceholder(args: string[]): boolean {
  return args.some((a) => /\$(@|\*|[1-9])/.test(a.replace(/\$\$/g, "")));
}

export function expandArgs(template: string[], userArgs: string[], env: Record<string, string> = {}): string[] {
  const result: string[] = [];
  let usedSpread = false;

  for (const token of template) {
    const expanded = expandToken(token, userArgs, env);
    if (token === "$@" || token === "$*") usedSpread = true;
    result.push(...expanded);
  }

  if (!usedSpread && !hasUserArgPlaceholder(template)) {
    result.push(...userArgs);
  }

  return result;
}

export function expandInput(
  template: Record<string, unknown>,
  userArgs: string[],
  env: Record<string, string> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(template)) {
    if (typeof val !== "string") {
      result[key] = val;
      continue;
    }
    const pure = val.match(/^\$([1-9])$/);
    if (pure) {
      const raw = userArgs[Number.parseInt(pure[1]!, 10) - 1];
      if (raw !== undefined) {
        try {
          result[key] = JSON.parse(raw);
        } catch {
          result[key] = raw;
        }
      } else {
        result[key] = "";
      }
      continue;
    }
    const expanded = expandToken(val, userArgs, env);
    result[key] = expanded.join(" ");
  }
  return result;
}

export function flattenInput(input: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    result.push(`--${k}`);
    result.push(typeof v === "string" ? v : JSON.stringify(v));
  }
  return result;
}

// --- Resolver ---

export function resolveAlias(
  target: HasAliases,
  subcommand: string,
  userArgs: string[],
  envCtx?: Record<string, string>,
): { subcommand: string; args: string[]; hasInput: boolean; scriptName: string } | null {
  const def = target.aliases?.[subcommand];
  if (!def) return null;

  const env = envCtx ?? {};

  if (def.input) {
    const expanded = expandInput(def.input as Record<string, unknown>, userArgs, env);
    return { subcommand: def.subcommand, args: flattenInput(expanded), hasInput: true, scriptName: subcommand };
  }

  if (def.args) {
    return {
      subcommand: def.subcommand,
      args: expandArgs(def.args, userArgs, env),
      hasInput: false,
      scriptName: subcommand,
    };
  }

  return { subcommand: def.subcommand, args: userArgs, hasInput: false, scriptName: subcommand };
}

// --- Listing ---

export function listAliases(target: HasAliases): Array<{
  name: string;
  subcommand: string;
  args?: string[];
  input?: Record<string, unknown>;
  description?: string;
}> {
  const aliases = target.aliases;
  if (!aliases) return [];
  return Object.entries(aliases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, def]) => ({
      name,
      subcommand: def.subcommand,
      args: def.args,
      input: def.input as Record<string, unknown> | undefined,
      description: def.description,
    }));
}

// --- Tools listing section (for executor "tools" output) ---

export function buildAliasSection(target: HasAliases): string {
  const aliases = listAliases(target);
  if (aliases.length === 0) return "";
  const lines = ["\nAliases:"];
  for (const s of aliases) {
    const detail = s.input ? JSON.stringify(s.input) : s.args?.length ? s.args.join(" ") : "(pass-through)";
    const desc = s.description ? `  — ${s.description}` : "";
    lines.push(`  ${s.name.padEnd(22)} [alias] ${s.subcommand}  ${detail}${desc}`);
  }
  return lines.join("\n") + "\n";
}

// --- Alias help output ---

export function formatAliasDef(name: string, def: AliasDef): string {
  const lines = [`Alias: ${name}`, `  → ${def.subcommand}`];
  if (def.args?.length) lines.push(`  args:  ${def.args.join(" ")}`);
  if (def.input) lines.push(`  input: ${JSON.stringify(def.input)}`);
  if (def.description) lines.push(`  desc:  ${def.description}`);
  return lines.join("\n");
}
