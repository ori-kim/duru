import type { Readable } from "node:stream";
import { createRouter, withRenderHint } from "@duru/cli-kit";
import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import {
  MEMORY_COLLECTION,
  QMD_INSTALL_MSG,
  createQmdClient,
  ensureMemoryCollection,
  memoryIdFromSearchResult,
  reindexMemory,
  reindexMemoryInBackground,
} from "./qmd.ts";
import type { MemoryQmdClient, MemoryQmdSearchResult } from "./qmd.ts";
import { createMemoryStore } from "./store.ts";
import type { MemoryItem, MemoryStore } from "./store.ts";

export { createMemoryStore, createMemoryPlugin };
export type { MemoryItem, MemoryStore, MemoryQmdClient, MemoryQmdSearchResult };

export type MemoryPluginOptions = {
  qmd?: MemoryQmdClient;
  now?: () => Date;
  timeZone?: string;
  stdin?: Readable & { isTTY?: boolean };
};

function createMemoryPlugin(options: MemoryPluginOptions = {}) {
  return virtualPlugin(async (cli) => {
    const home = createDuruFileHome({ env: process.env });
    const store = createMemoryStore(home.scope("memory"), { now: options.now, timeZone: options.timeZone });
    const qmd = options.qmd ?? createQmdClient(home.resolve("memory/.data"));
    const memory = createRouter();

    memory
      .command()
      .meta({ description: "Long-term memory commands" })
      .action((ctx) => {
        return ctx.exit(2, errorResult("Use memory search <query> or memory add <text>"));
      });

    memory
      .command("add [text]")
      .meta({ description: "Add a memory item" })
      .option("--tag <tag>", "Attach a tag")
      .option("--index", "Start background reindex after adding (default; use --no-index for agent/bulk writes)")
      .action(async (ctx) => {
        const text = (ctx.params as { text?: string }).text;
        const body = await memoryInput(text, options.stdin);
        const item = await store.add(body, { tags: optionValues((ctx.options as { tag?: unknown }).tag) });
        const indexing = await maybeScheduleReindex(qmd, store, ctx.options as IndexOptions);
        return ctx.exit(0, textResult(`Added memory: ${item.meta.id}`, { item, indexing }));
      });

    memory
      .command("search <query>")
      .meta({ description: "Search memory using qmd" })
      .option("--tag <tag>", "Filter by tag")
      .option("--mode <mode>", "Search mode: query, lex, or vec")
      .action(async (ctx) => {
        if (!(await qmd.isAvailable())) return ctx.exit(1, errorResult(QMD_INSTALL_MSG));
        try {
          await ensureMemoryCollection(qmd, store);
          const query = (ctx.params as { query: string }).query;
          const options = ctx.options as { tag?: unknown; mode?: string };
          const mode = options.mode ?? "query";
          const raw = await search(qmd, mode, query);
          const results = await filterSearchResults(store, raw, optionValues(options.tag));
          return ctx.exit(0, withRenderHint({ results, items: results.map(formatSearchResult) }, "list"));
        } catch (err) {
          return ctx.exit(1, errorResult(errorMessage(err)));
        }
      });

    memory
      .command("show <id>")
      .meta({ description: "Show a memory item" })
      .action(async (ctx) => {
        const id = (ctx.params as { id: string }).id;
        const item = await store.show(id);
        if (!item) return ctx.exit(1, errorResult(`Memory not found: ${id}`));
        return ctx.exit(0, textResult(item.body, { item }));
      });

    memory
      .command("tag <id> [...tags]")
      .meta({ description: "Update memory tags" })
      .option("--add <tag>", "Add a tag")
      .option("--remove <tag>", "Remove a tag")
      .option("--index", "Start background reindex after tagging (default; use --no-index for agent/bulk writes)")
      .action(async (ctx) => {
        const params = ctx.params as { id: string; tags?: string[] };
        const options = ctx.options as { add?: unknown; remove?: unknown } & IndexOptions;
        const tags = params.tags ?? [];
        const add = optionValues(options.add);
        const remove = optionValues(options.remove);
        if (tags.length > 0 && (add.length > 0 || remove.length > 0)) {
          return ctx.exit(2, errorResult("Use positional tags or --add/--remove, not both"));
        }
        if (tags.length === 0 && add.length === 0 && remove.length === 0) {
          return ctx.exit(2, errorResult("Pass tags, --add, or --remove"));
        }
        const item = await store.updateTags(params.id, tags.length > 0 ? { tags } : { add, remove });
        const indexing = await maybeScheduleReindex(qmd, store, options);
        return ctx.exit(0, textResult(`Updated memory tags: ${item.meta.id}`, { item, indexing }));
      });

    memory
      .command("delete <id>")
      .meta({ description: "Delete a memory item" })
      .option("--force", "Delete without confirmation")
      .option("--index", "Start background reindex after deleting (default; use --no-index for agent/bulk writes)")
      .action(async (ctx) => {
        const id = (ctx.params as { id: string }).id;
        const options = ctx.options as { force?: boolean } & IndexOptions;
        if (options.force !== true) return ctx.exit(2, errorResult("memory delete requires --force"));
        const deleted = await store.delete(id);
        if (!deleted) return ctx.exit(1, errorResult(`Memory not found: ${id}`));
        const indexing = await maybeScheduleReindex(qmd, store, options);
        return ctx.exit(0, textResult(`Deleted memory: ${id}`, { id, indexing }));
      });

    memory
      .command("clean")
      .meta({ description: "Clean memory store" })
      .option("--older-than <duration>", "Remove memories older than duration")
      .option("--dry-run", "Report candidates without deleting")
      .option("--index", "Start background reindex after cleanup (default; use --no-index for agent/bulk writes)")
      .action(async (ctx) => {
        const options = ctx.options as { olderThan?: string; dryRun?: boolean } & IndexOptions;
        const result = await store.clean({ olderThan: options.olderThan, dryRun: options.dryRun === true });
        const indexing =
          result.removed.length > 0 ? await maybeScheduleReindex(qmd, store, options) : skippedIndexing();
        return ctx.exit(0, textResult(`Cleaned memory: ${result.removed.length} removed`, { ...result, indexing }));
      });

    memory
      .command("reindex")
      .meta({ description: "Reindex memory into qmd" })
      .action(async (ctx) => {
        if (!(await qmd.isAvailable())) return ctx.exit(1, errorResult(QMD_INSTALL_MSG));
        await reindexMemory(qmd, store);
        return ctx.exit(0, textResult("Reindexed memory"));
      });

    memory
      .command("status")
      .meta({ description: "Show memory indexing status" })
      .action(async (ctx) => {
        const qmdAvailable = await qmd.isAvailable();
        if (!qmdAvailable) return ctx.exit(1, errorResult(QMD_INSTALL_MSG));
        return ctx.exit(
          0,
          textResult(`qmd: available\nmemory: ${store.memoryDir}`, {
            qmdAvailable,
            memoryDir: store.memoryDir,
            itemsDir: store.itemsDir,
            collection: MEMORY_COLLECTION,
          }),
        );
      });

    cli.subCommand("memory", memory as never);
  });
}

export default createMemoryPlugin();

type IndexOptions = {
  index?: boolean;
};

type IndexingResult =
  | { scheduled: true; mode: "background" }
  | { scheduled: false; mode: "skipped" | "failed"; error?: string };

type MemorySearchResult = {
  id: string;
  score: number;
  excerpt: string;
  tags: string[];
  path: string;
};

async function maybeScheduleReindex(
  qmd: MemoryQmdClient,
  store: MemoryStore,
  options: IndexOptions,
): Promise<IndexingResult> {
  if (options.index === false) return skippedIndexing();
  try {
    await reindexMemoryInBackground(qmd, store);
    return { scheduled: true, mode: "background" };
  } catch (err) {
    return { scheduled: false, mode: "failed", error: errorMessage(err) };
  }
}

function skippedIndexing(): IndexingResult {
  return { scheduled: false, mode: "skipped" };
}

async function search(qmd: MemoryQmdClient, mode: string, query: string): Promise<MemoryQmdSearchResult[]> {
  if (mode === "lex") return await qmd.lex(query, MEMORY_COLLECTION);
  if (mode === "vec") return await qmd.vsearch(query, MEMORY_COLLECTION);
  if (mode === "query") return await qmd.query(query, MEMORY_COLLECTION);
  throw new Error(`Unknown memory search mode: ${mode}`);
}

async function filterSearchResults(
  store: MemoryStore,
  raw: readonly MemoryQmdSearchResult[],
  tags: readonly string[] = [],
): Promise<MemorySearchResult[]> {
  const results: MemorySearchResult[] = [];
  for (const result of raw) {
    const id = memoryIdFromSearchResult(result);
    const item = await store.get(id);
    if (!item) continue;
    if (tags.length > 0 && !tags.every((tag) => item.meta.tags.includes(tag))) continue;
    results.push({
      id,
      score: result.score,
      excerpt: result.excerpt,
      tags: item.meta.tags,
      path: item.path,
    });
  }
  return results;
}

function formatSearchResult(result: MemorySearchResult): string {
  return `${result.id}  ${result.excerpt}`;
}

function textResult<T extends object>(text: string, extra?: T): T & { text: string } {
  return withRenderHint({ ...(extra ?? ({} as T)), text }, "text");
}

function errorResult(message: string): { message: string; exitCode: number } {
  return withRenderHint({ message, exitCode: 1 }, "error");
}

function optionValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitOptionValue);
  if (typeof value === "string") return splitOptionValue(value);
  return [];
}

function splitOptionValue(value: unknown): string[] {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function memoryInput(inline: string | undefined, stdin: MemoryPluginOptions["stdin"]): Promise<string> {
  if (inline !== undefined) return inline;
  const input = stdin ?? process.stdin;
  if (input.isTTY) throw new Error("memory text is required");
  const chunks: string[] = [];
  input.setEncoding("utf8");
  for await (const chunk of input) chunks.push(String(chunk));
  return chunks.join("");
}
