import { createCli, withRenderHint } from "@duru/cli-kit";
import { ClackCancelError, autocomplete } from "@duru/clack/prompt";
import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createIgnoreMatcher, loadIgnoreConfig } from "./config.ts";
import { rerun } from "./rerun.ts";
import { createHistoryStore } from "./store.ts";
import type { HistoryRecord } from "./types.ts";

export { createHistoryStore } from "./store.ts";
export { createIgnoreMatcher, loadIgnoreConfig } from "./config.ts";
export { rerun } from "./rerun.ts";
export type { HistoryRecord, HistoryStatus, HistoryListOptions, HistoryIgnoreConfig } from "./types.ts";

type ExitLike = { readonly kind: "duru.exit"; ok: boolean; exitCode: number };

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

export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const files = home.scope("history");
  const store = createHistoryStore(files);
  const matcher = createIgnoreMatcher(await loadIgnoreConfig(files));

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

  history
    .command()
    .meta({ description: "List recent command invocations" })
    .option("--limit <n>", "Max entries (default 50)")
    .option("--since <date>", "ISO date (YYYY-MM-DD) lower bound")
    .option("--grep <text>", "Filter by argv substring")
    .option("--errors", "Only failed invocations")
    .action(async (ctx) => {
      const limit = Number(ctx.options.limit) || 50;
      const records = await store.list({
        limit,
        since: typeof ctx.options.since === "string" ? ctx.options.since : undefined,
        grep: typeof ctx.options.grep === "string" ? ctx.options.grep : undefined,
        errorsOnly: ctx.options.errors === true,
      });
      const items = records.map(formatRecord);
      return ctx.exit(0, withRenderHint({ records, items }, "list"), true);
    });

  history
    .command("pick")
    .meta({ description: "Interactively pick a past invocation and re-run it" })
    .option("--limit <n>", "Candidates to show (default 100)")
    .action(async (ctx) => {
      if (!process.stdin.isTTY) {
        return ctx.exit(2, { error: { message: "pick requires a TTY; use `history rerun <id>` instead" } });
      }
      const limit = Number(ctx.options.limit) || 100;
      const records = await store.list({ limit });
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
    });

  history
    .command("rerun <id>")
    .meta({ description: "Re-run a recorded invocation by id" })
    .action(async (ctx) => {
      const id = ctx.params.id as string;
      const record = await store.get(id);
      if (!record) return ctx.exit(1, { error: { message: `no history entry: ${id}` } });
      const code = rerun(record.argv, { cwd: record.cwd });
      return ctx.exit(code, { rerun: record }, code === 0);
    });

  history
    .command("clear")
    .meta({ description: "Delete history files older than --before" })
    .option("--before <date>", "ISO date (YYYY-MM-DD); files strictly before are removed")
    .action(async (ctx) => {
      const before = typeof ctx.options.before === "string" ? ctx.options.before : undefined;
      if (!before) return ctx.exit(2, { error: { message: "--before <YYYY-MM-DD> is required" } });
      const removed = await store.clearBefore(before);
      return ctx.exit(0, { removed, before }, true);
    });

  cli.subCommand("history", history);
});
