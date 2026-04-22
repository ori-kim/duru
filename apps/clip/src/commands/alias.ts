import {
  type AliasDef,
  type HasAliases,
  buildAliasSection,
  formatAliasDef,
  listAliases,
  resolveAlias,
  expandArgs,
  expandInput,
  flattenInput,
} from "@clip/core";
import { getTarget, loadConfig, updateTarget } from "@clip/core";
import { die } from "@clip/core";

export { type HasAliases, buildAliasSection, listAliases, resolveAlias, expandArgs, expandInput, flattenInput };

const RESERVED_ALIAS_NAMES = new Set([
  "tools",
  "describe",
  "types",
  "refresh",
  "login",
  "logout",
  "query",
  "--help",
  "-h",
]);

// --- Management commands ---

async function runAliasAdd(args: string[]): Promise<void> {
  const [targetName, aliasName, ...rest] = args;
  if (!targetName || !aliasName) {
    die(
      "Usage: clip alias add <target> <name> --subcommand <sub> [--arg X ...] [--args-json '[...]'] [--input-json '{...}'] [--description \"...\"]",
    );
  }
  if (RESERVED_ALIAS_NAMES.has(aliasName)) {
    die(`"${aliasName}" is a reserved built-in name and cannot be used as an alias name.`);
  }

  let subcommand: string | undefined;
  let description: string | undefined;
  const argRepeated: string[] = [];
  let argsJson: string | undefined;
  let inputJson: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const val = rest[i + 1];
    if (flag === "--subcommand" && val !== undefined && !val.startsWith("--")) {
      subcommand = val;
      i++;
    } else if (flag === "--description" && val !== undefined && !val.startsWith("--")) {
      description = val;
      i++;
    } else if (flag === "--arg" && val !== undefined) {
      argRepeated.push(val);
      i++;
    } else if (flag === "--args-json" && val !== undefined && !val.startsWith("--")) {
      argsJson = val;
      i++;
    } else if (flag === "--input-json" && val !== undefined && !val.startsWith("--")) {
      inputJson = val;
      i++;
    } else
      die(
        `Unknown flag: ${flag}\nUsage: clip alias add <target> <name> --subcommand <sub> [--arg X ...] [--args-json '[...]'] [--input-json '{...}'] [--description "..."]`,
      );
  }

  if (!subcommand) die("--subcommand is required");
  if (argsJson && argRepeated.length > 0) die("Use --arg or --args-json, not both");
  if (inputJson && (argsJson || argRepeated.length > 0)) die("Use --input-json or --arg/--args-json, not both");

  let aliasArgs: string[] | undefined;
  let aliasInput: Record<string, unknown> | undefined;

  if (inputJson) {
    try {
      aliasInput = JSON.parse(inputJson) as Record<string, unknown>;
    } catch (e) {
      die(`Invalid --input-json: ${e}`);
    }
    if (typeof aliasInput !== "object" || Array.isArray(aliasInput)) die("--input-json must be a JSON object");
  } else if (argsJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson);
    } catch (e) {
      die(`Invalid --args-json: ${e}`);
    }
    if (!Array.isArray(parsed)) die("--args-json must be a JSON array of strings");
    if (!parsed.every((e) => typeof e === "string")) die("--args-json elements must all be strings");
    aliasArgs = parsed as string[];
  } else if (argRepeated.length > 0) {
    aliasArgs = argRepeated;
  }

  const entry: AliasDef = {
    subcommand,
    ...(aliasArgs ? { args: aliasArgs } : {}),
    ...(aliasInput ? { input: aliasInput } : {}),
    ...(description ? { description } : {}),
  };

  await updateTarget(targetName!, (raw) => {
    const aliases = (raw["aliases"] as Record<string, unknown> | undefined) ?? {};
    aliases[aliasName!] = entry;
    return { ...raw, aliases };
  });

  const hint = aliasInput ? ` with JSON input` : aliasArgs?.length ? ` with args [${aliasArgs.join(", ")}]` : "";
  console.log(`Alias "${aliasName}" added to "${targetName}" → ${subcommand}${hint}.`);
  if (aliasArgs?.some((a) => a.includes("$"))) {
    console.log(`  Tip: use single-quotes to pass '$1' etc. — e.g. --arg '\$1'`);
  }
}

async function runAliasRemove(args: string[]): Promise<void> {
  const [targetName, aliasName] = args;
  if (!targetName || !aliasName) die("Usage: clip alias remove <target> <name>");

  await updateTarget(targetName, (raw) => {
    const aliases = (raw["aliases"] as Record<string, unknown> | undefined) ?? {};
    if (!(aliasName in aliases)) die(`Alias "${aliasName}" not found on "${targetName}".`);
    delete aliases[aliasName];
    return { ...raw, aliases };
  });
  console.log(`Alias "${aliasName}" removed from "${targetName}".`);
}

async function runAliasList(args: string[]): Promise<void> {
  const [targetName] = args;
  if (!targetName) die("Usage: clip alias list <target>");

  const cfg = await loadConfig();
  const { target } = getTarget(cfg, targetName);
  const t = target as HasAliases;
  const aliases = t.aliases ?? {};
  const names = Object.keys(aliases);

  if (names.length === 0) {
    console.log(`No aliases on "${targetName}".`);
    console.log(`\nAdd one:\n  clip alias add ${targetName} <name> --subcommand <tool> --arg '\$1'`);
    return;
  }

  console.log(`Aliases for "${targetName}":`);
  for (const name of names.sort()) {
    const def = aliases[name]! as AliasDef;
    const detail = def.input ? JSON.stringify(def.input) : def.args?.length ? def.args.join(" ") : "(pass-through)";
    const desc = def.description ? `  — ${def.description}` : "";
    console.log(`  ${name.padEnd(22)} → ${def.subcommand}  ${detail}${desc}`);
  }
}

async function runAliasShow(args: string[]): Promise<void> {
  const [targetName, aliasName] = args;
  if (!targetName || !aliasName) die("Usage: clip alias show <target> <name>");

  const cfg = await loadConfig();
  const { target } = getTarget(cfg, targetName);
  const t = target as HasAliases;
  const def = t.aliases?.[aliasName];
  if (!def) die(`Alias "${aliasName}" not found on "${targetName}".`);

  console.log(formatAliasDef(aliasName, def));
}

export async function runAliasCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "add") await runAliasAdd(rest);
  else if (sub === "remove") await runAliasRemove(rest);
  else if (sub === "list") await runAliasList(rest);
  else if (sub === "show") await runAliasShow(rest);
  else {
    console.log("Usage: clip alias <add|remove|list|show> ...");
    console.log(
      "  clip alias add <target> <name> --subcommand <tool> [--arg X ...] [--args-json '[...]'] [--input-json '{...}'] [--description \"...\"]",
    );
    console.log("  clip alias remove <target> <name>");
    console.log("  clip alias list <target>");
    console.log("  clip alias show <target> <name>");
    console.log("\nPlaceholders in args/input: $1 $2 ... $@ $* ${VAR} $$");
    console.log("  $1..$9  positional (1-based)");
    console.log("  $@      spread all user args as separate tokens");
    console.log("  $*      join all user args as single token");
    console.log("  ${VAR}  environment variable");
    console.log("  $$      literal $");
    console.log("\nShell tip: use single-quotes to prevent shell expansion: --arg '\\$1'");
  }
}
