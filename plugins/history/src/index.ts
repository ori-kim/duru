import { ClackCancelError, autocomplete, select } from "@duru/clack/prompt";
import { createCli, withRenderHint } from "@duru/cli-kit";
import type { Context } from "@duru/cli-kit";
import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createIgnoreMatcher, loadHistoryConfig, saveDefaultAction } from "./config.ts";
import { rerun } from "./rerun.ts";
import { createHistoryStore } from "./store.ts";
import type { HistoryRecord } from "./types.ts";

export { createHistoryStore } from "./store.ts";
export { createIgnoreMatcher, loadHistoryConfig, loadIgnoreConfig, saveDefaultAction } from "./config.ts";
export { rerun } from "./rerun.ts";
export type {
  HistoryConfig,
  HistoryDefaultAction,
  HistoryIgnoreConfig,
  HistoryListOptions,
  HistoryRecord,
  HistoryStatus,
} from "./types.ts";

type ExitLike = { readonly kind: "duru.exit"; ok: boolean; exitCode: number };
type HistoryAction = "list" | "pick";
type HistoryOptions = {
  readonly limit?: unknown;
  readonly since?: unknown;
  readonly grep?: unknown;
  readonly errors?: unknown;
};
type HistoryContext = Context<HistoryOptions>;

function isExitResult(value: unknown): value is ExitLike {
  return typeof value === "object" && value !== null && (value as ExitLike).kind === "duru.exit";
}

function deriveStatus(
  result: unknown,
  error: unknown,
  matched: boolean,
): { status: "ok" | "error" | "cancelled"; exitCode: number } {
  if (error) {
    if (error instanceof ClackCancelError) return { status: "cancelled", exitCode: 130 };
    return { status: "error", exitCode: 1 };
  }
  if (isExitResult(result)) {
    return { status: result.ok ? "ok" : "error", exitCode: result.exitCode };
  }
  if (!matched) return { status: "error", exitCode: 1 };
  return { status: "ok", exitCode: 0 };
}

function formatRecord(record: HistoryRecord): string {
  const status = record.status === "ok" ? "✓" : record.status === "cancelled" ? "⨯" : "✘";
  const argv = record.argv.join(" ");
  return `${status} ${record.id}  ${record.at}  duru ${argv}`;
}

function resolveLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback;
}

export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const files = home.scope("history");
  const store = createHistoryStore(files);
  const config = await loadHistoryConfig(files);
  const matcher = createIgnoreMatcher(config);
  let defaultAction = config.defaultAction;
  const listLimit = config.limit ?? 50;
  const pickLimit = config.limit ?? 100;

  cli.option("--history", "Record this invocation to history (use --no-history to skip)");

  cli.use(async (ctx, next) => {
    const argv = ctx.request.argv;
    const opts = ctx.options as { history?: boolean };
    const disabled = opts.history === false;

    if (disabled || matcher.isIgnored(argv)) return next();

    const startedAt = new Date();
    const startedMs = Date.now();
    let result: unknown;
    let captured: unknown;
    try {
      result = await next();
      captured = result;
      return result;
    } catch (err) {
      captured = err;
      throw err;
    } finally {
      const error = captured instanceof Error ? captured : undefined;
      const matched = Boolean(ctx.request.pattern);
      const { status, exitCode } = deriveStatus(result, error, matched);
      try {
        await store.append({
          at: startedAt.toISOString(),
          argv: [...argv],
          cwd: process.cwd(),
          status,
          exitCode,
          durationMs: Date.now() - startedMs,
        });
      } catch {
        /* swallow — never let history failures break the command */
      }
    }
  });

  const history = createCli();

  async function runList(ctx: HistoryContext) {
    const limit = resolveLimit(ctx.options.limit, listLimit);
    const records = await store.list({
      limit,
      since: typeof ctx.options.since === "string" ? ctx.options.since : undefined,
      grep: typeof ctx.options.grep === "string" ? ctx.options.grep : undefined,
      errorsOnly: ctx.options.errors === true,
    });
    const items = records.map(formatRecord);
    return ctx.exit(0, withRenderHint({ records, items }, "list"), true);
  }

  async function runPick(ctx: HistoryContext) {
    if (!process.stdin.isTTY) {
      return ctx.exit(2, { error: { message: "pick requires a TTY" } });
    }
    const limit = resolveLimit(ctx.options.limit, pickLimit);
    const records = await store.list({
      limit,
      since: typeof ctx.options.since === "string" ? ctx.options.since : undefined,
      grep: typeof ctx.options.grep === "string" ? ctx.options.grep : undefined,
      errorsOnly: ctx.options.errors === true,
    });
    if (records.length === 0) return ctx.exit(0, { message: "history is empty" }, true);

    try {
      const id = await autocomplete<string>({
        message: "Pick a command to re-run",
        options: records.map((r) => ({
          value: r.id,
          label: `duru ${r.argv.join(" ")}`,
          hint: `${r.at} · ${r.status}`,
        })),
      });
      const record = records.find((r) => r.id === id);
      if (!record) return ctx.exit(1, { error: { message: `record not found: ${id}` } });
      const code = rerun(record.argv, { cwd: record.cwd });
      return ctx.exit(code, { rerun: record }, code === 0);
    } catch (err) {
      if (err instanceof ClackCancelError) return ctx.exit(130, { message: "cancelled" }, false);
      throw err;
    }
  }

  async function selectAndSaveDefaultAction(ctx: HistoryContext) {
    try {
      const action = await select<HistoryAction>({
        message: "Choose a history shortcut",
        initialValue: "list",
        options: [
          { value: "list", label: "List", hint: "Show recent command invocations" },
          { value: "pick", label: "Pick", hint: "Choose a past invocation and re-run it" },
        ],
      });
      await saveDefaultAction(files, action);
      defaultAction = action;
      return action;
    } catch (err) {
      if (err instanceof ClackCancelError) return ctx.exit(130, { message: "cancelled" }, false);
      throw err;
    }
  }

  history
    .command()
    .meta({ description: "Run configured history shortcut" })
    .option("--limit <n>", "Max entries")
    .option("--since <date>", "ISO date (YYYY-MM-DD) lower bound")
    .option("--grep <text>", "Filter by argv substring")
    .option("--errors", "Only failed invocations")
    .action(async (ctx) => {
      const historyCtx = ctx as HistoryContext;
      if (!defaultAction && !process.stdin.isTTY) return runList(historyCtx);

      const action = defaultAction ?? (await selectAndSaveDefaultAction(historyCtx));
      if (typeof action !== "string") return action;
      return action === "pick" ? runPick(historyCtx) : runList(historyCtx);
    });

  history
    .command("list")
    .meta({ description: "List recent command invocations" })
    .option("--limit <n>", "Max entries")
    .option("--since <date>", "ISO date (YYYY-MM-DD) lower bound")
    .option("--grep <text>", "Filter by argv substring")
    .option("--errors", "Only failed invocations")
    .action(async (ctx) => runList(ctx as HistoryContext));

  history
    .command("pick")
    .meta({ description: "Interactively pick a past invocation and re-run it" })
    .option("--limit <n>", "Candidates to show")
    .option("--since <date>", "ISO date (YYYY-MM-DD) lower bound")
    .option("--grep <text>", "Filter candidates by argv substring")
    .option("--errors", "Only failed invocations")
    .action(async (ctx) => runPick(ctx as HistoryContext));

  cli.subCommand("history", history);
});
