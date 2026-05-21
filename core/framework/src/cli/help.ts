import type { HelpRoute } from "../types/index.ts";

export function usageHelpRoutes(usage: string): HelpRoute[] {
  return commandLines(usage).map((line) => ({ pattern: line.trim().split(/\s{2,}/)[0] ?? "", options: [] }));
}

export function helpPath(argv: readonly string[], routes: readonly HelpRoute[]): readonly string[] {
  const positionals = argv.filter((token) => token !== "--help" && token !== "-h" && !token.startsWith("-"));
  const route = routes.find((route) => routePatternMatches(route.pattern, positionals));
  return route ? literalPath(route.pattern) : positionals;
}

export function isHelpRequest(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function commandLines(usage: string): string[] {
  const lines = usage.split("\n");
  const commandsIndex = lines.findIndex((line) => line.trim() === "Commands:");
  const linesAfterHeader = commandsIndex === -1 ? lines : lines.slice(commandsIndex + 1);
  return linesAfterHeader.filter((line) => line.trim().length > 0);
}

function routePatternMatches(pattern: string, argv: readonly string[]): boolean {
  const tokens = patternTokens(pattern);
  let index = 0;

  for (const token of tokens) {
    if (token.startsWith("<...") || token.startsWith("[...")) return true;
    if (token.startsWith("<")) {
      if (argv[index] === undefined) return false;
      index += 1;
      continue;
    }
    if (token.startsWith("[")) {
      if (argv[index] !== undefined) index += 1;
      continue;
    }
    if (argv[index] !== token) return false;
    index += 1;
  }

  return index === argv.length;
}

function literalPath(pattern: string): readonly string[] {
  return patternTokens(pattern).filter((token) => !token.startsWith("<") && !token.startsWith("["));
}

function patternTokens(pattern: string): readonly string[] {
  return pattern.trim().split(/\s+/).filter(Boolean);
}
