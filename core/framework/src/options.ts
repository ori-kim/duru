import type { OptionValue, Options } from "./types.ts";

export type OptionDefinition = {
  name: string;
  aliases: readonly string[];
  type: "boolean" | "value";
  description?: string;
};

export type ParsedOptions = {
  options: Options;
  positionals: string[];
};

export function parseOptionSpec(spec: string, description?: string): OptionDefinition {
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

export function parseOptions(argv: readonly string[], definitions: readonly OptionDefinition[]): ParsedOptions {
  const options: Options = {};
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
): { name: string; value: OptionValue; consumedNext: boolean } | undefined {
  const [rawName, inlineValue] = token.split("=", 2) as [string, string | undefined];
  const noName = rawName.startsWith("--no-") ? `--${rawName.slice(5)}` : rawName;
  const definition = definitions.find((item) => item.aliases.includes(noName));
  if (!definition) return undefined;
  if (rawName.startsWith("--no-")) return { name: definition.name, value: false, consumedNext: false };
  if (definition.type === "boolean") return { name: definition.name, value: true, consumedNext: false };
  if (inlineValue !== undefined) return { name: definition.name, value: inlineValue, consumedNext: false };
  return { name: definition.name, value: nextToken ?? "", consumedNext: nextToken !== undefined };
}

function mergeOptionValue(current: OptionValue | undefined, next: OptionValue): OptionValue {
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
