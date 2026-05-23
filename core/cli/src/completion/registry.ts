import type { HelpDocument, HelpRoute, OptionDefinition } from "../types/index.ts";
import type {
  CompletionContext,
  CompletionContributor,
  CompletionContributorError,
  CompletionItem,
  CompletionOptions,
  CompletionResult,
} from "./types.ts";

export function createCompletionRegistry() {
  const contributors: CompletionContributor[] = [];

  return {
    add(contributor: CompletionContributor) {
      contributors.push(contributor);
    },
    list(): readonly CompletionContributor[] {
      return [...contributors];
    },
  };
}

export async function completeFromContributors(
  ctx: CompletionContext,
  contributors: readonly CompletionContributor[],
  _options: CompletionOptions = {},
): Promise<CompletionResult> {
  const items: CompletionItem[] = [];
  const errors: CompletionContributorError[] = [];

  for (const contributor of contributors) {
    try {
      items.push(...(await contributor.complete(ctx)));
    } catch (error) {
      errors.push({ contributor: contributor.id, message: errorMessage(error) });
    }
  }

  return {
    items: dedupeItems(items.filter((item) => !item.hidden && item.value.trim())),
    errors,
  };
}

export function commandGraphCompletionContributor(
  getHelpDocument: (argv: readonly string[]) => HelpDocument,
): CompletionContributor {
  return {
    id: "duru.commands",
    complete(ctx) {
      return completeCommandGraph(ctx, getHelpDocument(ctx.argv));
    },
  };
}

function completeCommandGraph(ctx: CompletionContext, document: HelpDocument): readonly CompletionItem[] {
  if (ctx.current.startsWith("-") && ctx.current !== "-") return completeOptions(ctx, document);
  return completeCommands(ctx, document);
}

function completeCommands(ctx: CompletionContext, document: HelpDocument): readonly CompletionItem[] {
  const previousTokens = ctx.argv.slice(0, ctx.position).filter((token) => token !== "");
  const items: CompletionItem[] = [];

  for (const entry of completionRouteEntries(document.routes)) {
    const tokens = patternTokens(entry.pattern);
    if (!matchesPatternPrefix(tokens, previousTokens)) continue;

    const candidate = tokens[previousTokens.length];
    if (!candidate || !isLiteralToken(candidate) || !candidate.startsWith(ctx.current)) continue;

    items.push({
      value: candidate,
      ...(entry.route.description ? { description: entry.route.description } : {}),
      kind: "command",
      group: entry.route.group ?? "commands",
    });
  }

  return items;
}

function completeOptions(ctx: CompletionContext, document: HelpDocument): readonly CompletionItem[] {
  const positionals = ctx.argv.slice(0, ctx.position).filter((token) => token && !isOptionLike(token));
  const routeOptions = document.routes
    .filter((route) => !route.hidden)
    .filter((route) => matchesPatternPrefix(patternTokens(route.pattern), positionals))
    .flatMap((route) => route.options);
  const definitions = [...document.globalOptions, ...routeOptions];
  const items: CompletionItem[] = [];

  for (const definition of definitions) {
    for (const alias of definition.aliases) {
      if (!alias.startsWith(ctx.current)) continue;
      items.push(optionItem(alias, definition));
    }
  }

  return items;
}

function optionItem(value: string, definition: OptionDefinition): CompletionItem {
  return {
    value,
    ...(definition.description ? { description: definition.description } : {}),
    kind: "option",
    group: "options",
  };
}

function completionRouteEntries(routes: readonly HelpRoute[]): Array<{ pattern: string; route: HelpRoute }> {
  const entries: Array<{ pattern: string; route: HelpRoute }> = [];
  for (const route of routes) {
    if (route.hidden) continue;
    entries.push({ pattern: route.pattern, route });
    for (const alias of route.aliases ?? []) entries.push({ pattern: alias, route });
  }
  return entries;
}

function matchesPatternPrefix(pattern: readonly string[], input: readonly string[]): boolean {
  if (input.length > pattern.length) return false;
  return input.every((token, index) => tokenMatchesPattern(pattern[index], token));
}

function tokenMatchesPattern(patternToken: string | undefined, value: string): boolean {
  if (!patternToken) return false;
  if (isParamToken(patternToken)) return true;
  return patternToken === value;
}

function dedupeItems(items: readonly CompletionItem[]): readonly CompletionItem[] {
  const seen = new Set<string>();
  const next: CompletionItem[] = [];
  for (const item of items) {
    const key = [item.group ?? "", item.kind ?? "", item.value].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function patternTokens(pattern: string): string[] {
  return pattern.trim().split(/\s+/).filter(Boolean);
}

function isLiteralToken(token: string): boolean {
  return !isParamToken(token);
}

function isParamToken(token: string): boolean {
  return /^(?:<\.\.\.[^<>\[\]\s]+>|\[[^\]<>\s]+\]|<[^<>\[\]\s]+>|\[\.\.\.[^\]<>\s]+\])$/.test(token);
}

function isOptionLike(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
