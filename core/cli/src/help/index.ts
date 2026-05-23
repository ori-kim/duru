import { parseOptionSpec } from "../options/index.ts";
import { createPlugin } from "../plugin/index.ts";
import type { CommandExample, HelpDocument, HelpRoute, OptionDefinition } from "../types/index.ts";

export type HelpPluginOptions = {
  showOnEmpty?: boolean;
  optionDescription?: string;
};

export function help(options: HelpPluginOptions = {}) {
  const showOnEmpty = options.showOnEmpty ?? true;
  return createPlugin<{ help?: boolean }>((api) => {
    api.option(parseOptionSpec("-h, --help", options.optionDescription ?? "Show help"));
    api.middleware(async (ctx, next) => {
      if (!ctx.options.help && !(showOnEmpty && ctx.request.argv.length === 0)) return next();

      const document = api.helpDocument(ctx.request.argv);
      const emitted = await ctx.emit("help", { document });
      return emitted ?? document;
    });
  });
}

export function formatHelp(document: HelpDocument): string {
  const exact = findExactRoute(document.routes, document.path);
  const routes = filterRoutes(document.routes, document.path);
  if (exact && !hasVisibleNestedRoute(routes, document.path)) {
    return commandHelp(document.name, exact, document.globalOptions);
  }

  const usage =
    document.path.length === 0 ? `${document.name} <command>` : `${document.name} ${document.path.join(" ")} <command>`;
  const lines = [`Usage: ${usage}`, "", "Commands:"];
  appendRoutes(lines, routes);
  appendOptions(lines, document.globalOptions);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function isHelpDocument(value: unknown): value is HelpDocument {
  return isRecord(value) && typeof value.name === "string" && Array.isArray(value.path) && Array.isArray(value.routes);
}

export function usageHelpRoutes(usage: string): HelpRoute[] {
  return commandLines(usage).map((line) => ({ pattern: line.trim().split(/\s{2,}/)[0] ?? "", options: [] }));
}

export function helpPath(argv: readonly string[], routes: readonly HelpRoute[]): readonly string[] {
  const positionals = argv.filter((token) => token !== "--help" && token !== "-h" && !token.startsWith("-"));
  const route = routes.find((route) =>
    routePatterns(route).some((pattern) => routePatternMatches(pattern, positionals)),
  );
  return route ? literalPath(route.pattern) : positionals;
}

function commandHelp(name: string, route: HelpRoute, globalOptions: readonly OptionDefinition[]): string {
  const options = [...globalOptions, ...route.options];
  const lines = [`Usage: ${commandUsage(name, route)}`];
  if (route.description) lines.push("", route.description);
  const deprecated = deprecatedText(route.deprecated);
  if (deprecated) lines.push("", deprecated);
  appendAliases(lines, route.aliases ?? []);
  appendOptions(lines, options);
  appendExamples(lines, route.examples ?? []);
  return `${lines.join("\n").trimEnd()}\n`;
}

function commandUsage(name: string, route: HelpRoute): string {
  const usage = route.usage?.trim();
  if (!usage) return `${name} ${route.pattern}`;
  if (usage.startsWith(name)) return usage;
  return `${name} ${usage}`;
}

function appendRoutes(lines: string[], routes: readonly HelpRoute[]): void {
  const visibleRoutes = routes.filter((route) => !route.hidden);
  if (!visibleRoutes.some((route) => route.group)) {
    for (const route of visibleRoutes) lines.push(`  ${route.pattern}${routeDetails(route)}`);
    return;
  }

  for (const [group, groupRoutes] of groupedRoutes(visibleRoutes)) {
    lines.push(`  ${group}:`);
    for (const route of groupRoutes) lines.push(`    ${route.pattern}${routeDetails(route)}`);
  }
}

function groupedRoutes(routes: readonly HelpRoute[]): Array<[string, HelpRoute[]]> {
  const groups: Array<[string, HelpRoute[]]> = [];
  for (const route of routes) {
    const group = route.group ?? "Other";
    const existing = groups.find(([name]) => name === group);
    if (existing) {
      existing[1].push(route);
    } else {
      groups.push([group, [route]]);
    }
  }
  return groups;
}

function routeDetails(route: HelpRoute): string {
  const details = [route.description, deprecatedText(route.deprecated)].filter(Boolean).join(" ");
  return details ? `  ${details}` : "";
}

function deprecatedText(value: boolean | string | undefined): string {
  if (value === true) return "deprecated";
  if (typeof value === "string") return `deprecated: ${value}`;
  return "";
}

function appendAliases(lines: string[], aliases: readonly string[]): void {
  if (aliases.length === 0) return;
  lines.push("", "Aliases:");
  for (const alias of aliases) lines.push(`  ${alias}`);
}

function appendExamples(lines: string[], examples: readonly CommandExample[]): void {
  if (examples.length === 0) return;
  lines.push("", "Examples:");
  for (const example of examples) lines.push(`  ${exampleUsage(example)}`);
}

function exampleUsage(example: CommandExample): string {
  if (typeof example === "string") return example;
  return [example.command, example.description].filter(Boolean).join("  ");
}

function appendOptions(lines: string[], options: readonly OptionDefinition[]): void {
  if (options.length === 0) return;
  lines.push("", "Options:");
  for (const option of options) {
    lines.push(`  ${option.aliases.join(", ")}${option.description ? `  ${option.description}` : ""}`);
  }
}

function filterRoutes(routes: readonly HelpRoute[], path: readonly string[]): HelpRoute[] {
  if (path.length === 0) return [...routes];
  return routes.filter((route) => routePatterns(route).some((pattern) => startsWith(literalPath(pattern), path)));
}

function findExactRoute(routes: readonly HelpRoute[], path: readonly string[]): HelpRoute | undefined {
  if (path.length === 0) return undefined;
  return routes.find((route) => routePatterns(route).some((pattern) => equals(literalPath(pattern), path)));
}

function hasVisibleNestedRoute(routes: readonly HelpRoute[], path: readonly string[]): boolean {
  return routes.some(
    (route) =>
      !route.hidden &&
      routePatterns(route).some((pattern) => {
        const literal = literalPath(pattern);
        return literal.length > path.length && startsWith(literal, path);
      }),
  );
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

function routePatterns(route: HelpRoute): readonly string[] {
  return [route.pattern, ...(route.aliases ?? [])];
}

function literalPath(pattern: string): string[] {
  return patternTokens(pattern).filter((token) => !token.startsWith("<") && !token.startsWith("["));
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

function equals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && startsWith(left, right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function patternTokens(pattern: string): string[] {
  return pattern.trim().split(/\s+/).filter(Boolean);
}
