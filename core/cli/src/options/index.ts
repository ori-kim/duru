import type { OptionDefinition, OptionSpec, ParsedOptionValue, ParsedOptions } from "../types/index.ts";

export function parseOptionSpec<TSpec extends string>(spec: OptionSpec<TSpec>, description?: string): OptionDefinition {
  validateOptionSpec(spec);
  const aliases = spec
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((part): part is string => Boolean(part));
  const longName = aliases.find((alias) => alias.startsWith("--"));
  const fallback = aliases[0] ?? spec;
  const name = toOptionName(longName ?? fallback);
  const type = spec.includes("<") || spec.includes("[") ? "value" : "boolean";
  return { name, aliases, type, ...(description ? { description } : {}) };
}

export function validateOptionDefinition(definition: OptionDefinition): void {
  if (!definition.name.trim()) throw new Error("Invalid option definition: option name cannot be empty.");
  if (definition.type !== "boolean" && definition.type !== "value") {
    throw new Error(`Invalid option definition "${definition.name}": option type must be "boolean" or "value".`);
  }
  if (!definition.aliases.some((alias) => isLongOptionAlias(alias))) {
    throw new Error(
      `Invalid option definition "${definition.name}": option definitions must include a long alias starting with "--". Example: "--dry-run" or "-d, --dry-run".`,
    );
  }
  for (const alias of definition.aliases) {
    if (!isOptionAlias(alias)) {
      throw new Error(
        `Invalid option definition "${definition.name}": option aliases must start with "-" and cannot be empty. Example: "--dry-run" or "-d, --dry-run".`,
      );
    }
  }
}

export function parseOptions(argv: readonly string[], definitions: readonly OptionDefinition[]): ParsedOptions {
  const options: Record<string, ParsedOptionValue | undefined> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    const parsed = parseOptionToken(token, argv[index + 1], definitions);
    if (!parsed) {
      positionals.push(token);
      continue;
    }
    options[parsed.name] = mergeOptionValue(options[parsed.name], parsed.value);
    if (parsed.consumedNext) index += 1;
  }

  return { options, positionals };
}

function parseOptionToken(
  token: string,
  nextToken: string | undefined,
  definitions: readonly OptionDefinition[],
): { name: string; value: ParsedOptionValue; consumedNext: boolean } | undefined {
  const [rawName, inlineValue] = token.split("=", 2) as [string, string | undefined];
  const noName = rawName.startsWith("--no-") ? `--${rawName.slice(5)}` : rawName;
  const definition = definitions.find((item) => item.aliases.includes(noName));
  if (!definition) return undefined;
  if (rawName.startsWith("--no-")) return { name: definition.name, value: false, consumedNext: false };
  if (definition.type === "boolean") return { name: definition.name, value: true, consumedNext: false };
  if (inlineValue !== undefined) return { name: definition.name, value: inlineValue, consumedNext: false };
  return { name: definition.name, value: nextToken ?? "", consumedNext: nextToken !== undefined };
}

function mergeOptionValue(current: ParsedOptionValue | undefined, next: ParsedOptionValue): ParsedOptionValue {
  if (current === undefined) return next;
  if (Array.isArray(current)) return [...current, String(next)];
  return [String(current), String(next)];
}

function toOptionName(value: string): string {
  return value
    .replace(/^-+/, "")
    .replace(/^no-/, "")
    .replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function validateOptionSpec(spec: string): void {
  const aliases = spec
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((part): part is string => Boolean(part));
  if (!aliases.some((alias) => isLongOptionAlias(alias))) {
    throw new Error(
      `Invalid option spec "${spec}": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".`,
    );
  }
  for (const alias of aliases) {
    if (!isOptionAlias(alias)) {
      throw new Error(
        `Invalid option spec "${spec}": option aliases must start with "-" and cannot be empty. Example: "--json" or "-j, --json".`,
      );
    }
  }
}

function isOptionAlias(value: string): boolean {
  return isLongOptionAlias(value) || isShortOptionAlias(value);
}

function isLongOptionAlias(value: string): boolean {
  return /^--[^\s,<>\[\]-][^\s,<>\[\]]*$/.test(value);
}

function isShortOptionAlias(value: string): boolean {
  return /^-[^\s,<>\[\]-][^\s,<>\[\]]*$/.test(value);
}
