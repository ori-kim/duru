import type { HelpDocument, HelpRoute, OptionDefinition } from "../types/index.ts";

export function formatHelp(document: HelpDocument): string {
  const exact = findExactRoute(document.routes, document.path);
  if (exact) return commandHelp(document.name, exact, document.globalOptions);

  const routes = filterRoutes(document.routes, document.path);
  const usage =
    document.path.length === 0 ? `${document.name} <command>` : `${document.name} ${document.path.join(" ")} <command>`;
  const lines = [`Usage: ${usage}`, "", "Commands:"];
  for (const route of routes) {
    lines.push(`  ${route.pattern}${route.description ? `  ${route.description}` : ""}`);
  }
  appendOptions(lines, document.globalOptions);
  return `${lines.join("\n").trimEnd()}\n`;
}

function commandHelp(name: string, route: HelpRoute, globalOptions: readonly OptionDefinition[]): string {
  const options = [...globalOptions, ...route.options];
  const lines = [`Usage: ${name} ${route.pattern}`];
  if (route.description) lines.push("", route.description);
  if (options.length > 0) {
    appendOptions(lines, options);
  }
  return `${lines.join("\n").trimEnd()}\n`;
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
  return routes.filter((route) => startsWith(literalPath(route.pattern), path));
}

function findExactRoute(routes: readonly HelpRoute[], path: readonly string[]): HelpRoute | undefined {
  if (path.length === 0) return undefined;
  return routes.find((route) => equals(literalPath(route.pattern), path));
}

function literalPath(pattern: string): string[] {
  return pattern
    .trim()
    .split(/\s+/)
    .filter((token) => token && !token.startsWith("<") && !token.startsWith("["));
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

function equals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && startsWith(left, right);
}
