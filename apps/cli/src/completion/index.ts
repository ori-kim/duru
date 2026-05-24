import { createCli, createPlugin } from "@duru/cli-kit";
import type { CliPlugin, CliPluginApi, CompletionContext, CompletionResult } from "@duru/cli-kit";
import { queryCompletionItems, renderZshCompletion } from "@duru/completion-zsh";
import type { ZshCompletionStyle } from "@duru/completion-zsh";

export type AppCompletionPluginOptions = {
  commandName?: string;
  routeName?: string;
  cacheTtlMs?: number;
};

const gatewayZshStyles: readonly ZshCompletionStyle[] = [
  { tag: "cli-targets", format: "%F{green}── %d ──%f", color: "=*=32" },
  { tag: "mcp-targets", format: "%F{yellow}── %d ──%f", color: "=*=33" },
  { tag: "api-targets", format: "%F{cyan}── %d ──%f", color: "=*=36" },
  { tag: "grpc-targets", format: "%B%F{blue}── %d ──%f%b", color: "=*=34;1" },
  { tag: "graphql-targets", format: "%F{205}── %d ──%f", color: "=*=38;5;205" },
  { tag: "script-targets", format: "%F{245}── %d ──%f", color: "=*=38;5;245" },
  { tag: "gateway-bindings", format: "%F{246}── %d ──%f", color: "=*=38;5;246" },
  { tag: "gateway-profiles", format: "%F{246}── %d ──%f", color: "=*=38;5;246" },
  { tag: "gateway-aliases", format: "%F{246}── %d ──%f", color: "=*=38;5;246" },
  { tag: "gateway-operations", format: "%F{246}── %d ──%f", color: "=*=38;5;246" },
];

export function createAppCompletionPlugin(options: AppCompletionPluginOptions = {}): CliPlugin {
  return createPlugin((api) => {
    const commandName = options.commandName ?? "duru";
    const routeName = options.routeName ?? "completion";
    const cache = createCompletionCache(options.cacheTtlMs ?? 30000);
    const completion = createCli();

    completion
      .command("zsh", "Print zsh completion script")
      .option("--name <name>", "Override command name")
      .action((ctx) => {
        const name = typeof ctx.options.name === "string" ? ctx.options.name : commandName;
        return renderZshCompletion({
          commandName: name,
          queryCommand: [routeName, "query"],
          styles: gatewayZshStyles,
        });
      });

    completion
      .command("query [...words]", "Query completion candidates")
      .option("--shell <shell>", "Completion shell")
      .option("--cursor <cursor>", "Current shell cursor word")
      .option("--name <name>", "Command name")
      .option("--cache", "Use completion cache")
      .option("--debug", "Include contributor errors")
      .hidden()
      .action(async (ctx) => {
        if (ctx.options.shell !== "zsh") return { items: [] };

        const words = stringArrayParam(ctx.params.words);
        const name = typeof ctx.options.name === "string" ? ctx.options.name : commandName;
        const cursor = typeof ctx.options.cursor === "string" ? Number(ctx.options.cursor) : undefined;
        const noCache = ctx.options.cache === false;
        const debug = ctx.options.debug === true;

        try {
          const result = await queryCompletionItems({
            commandName: name,
            words,
            ...(cursor !== undefined && Number.isFinite(cursor) ? { cursor } : {}),
            complete: (completionCtx) =>
              cachedComplete(cache, api, completionCtx, {
                noCache,
                debug,
              }),
          });
          return debug ? { ...result, errors: lastErrors(cache) } : result;
        } catch (error) {
          if (debug) return { items: [], errors: [{ contributor: "completion.query", message: errorMessage(error) }] };
          return { items: [] };
        }
      });

    api.subCommand(routeName, completion);
  });
}

type CompletionCache = {
  ttlMs: number;
  entries: Map<string, { expiresAt: number; result: CompletionResult }>;
  lastErrors: CompletionResult["errors"];
};

function createCompletionCache(ttlMs: number): CompletionCache {
  return { ttlMs, entries: new Map(), lastErrors: [] };
}

async function cachedComplete(
  cache: CompletionCache,
  api: CliPluginApi,
  ctx: CompletionContext,
  options: { noCache: boolean; debug: boolean },
): Promise<CompletionResult> {
  const key = JSON.stringify(ctx);
  const now = Date.now();
  if (!options.noCache) {
    const existing = cache.entries.get(key);
    if (existing && existing.expiresAt > now) {
      cache.lastErrors = existing.result.errors;
      return existing.result;
    }
  }

  const result = await api.complete(ctx, { debug: options.debug });
  cache.lastErrors = result.errors;
  cache.entries.set(key, { expiresAt: now + cache.ttlMs, result });
  return result;
}

function lastErrors(cache: CompletionCache): CompletionResult["errors"] {
  return cache.lastErrors;
}

function stringArrayParam(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
