import { spawnSync } from "node:child_process";
import { CONFIG_DIR, die } from "@clip/core";
import type { CliHookCtx, ClipExtension } from "@clip/core";
import {
  type HistoryQueryOptions,
  type HistoryQueryResult,
  type HistoryRecord,
  findHistoryRecord,
  formatHistoryCommand,
  formatHistoryFullCommand,
  historyDir,
  queryHistory,
  recordCliEnd,
  summarizeHistoryRecord,
} from "./record.ts";

type HistoryFormat = "table" | "json" | "jsonl" | "fzf";

type ParsedHistoryArgs = HistoryQueryOptions & {
  format: HistoryFormat;
  all: boolean;
  page?: number;
  pageSize?: number;
};

const DEFAULT_LIMIT = 50;

function usage(): string {
  return [
    "Usage:",
    "  clip history [list] [--limit N] [--offset N] [--page N] [--page-size N]",
    "  clip history [list] [--target NAME] [--type TYPE] [--status ok|failed|CODE] [--since DATE] [--until DATE]",
    "  clip history search <query> [filters...]",
    "  clip history show <id-prefix> [--json]",
    "  clip history <id-prefix> [--json]",
    "  clip history pick [filters...]",
    "  clip history path",
    "",
    "Formats:",
    "  --format table|json|jsonl|fzf",
    "  --json is shorthand for --format json",
    "",
    "fzf:",
    "  clip history --format fzf --all | fzf --delimiter='\\t' --with-nth=2.. --preview 'clip history show {1}'",
  ].join("\n");
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) die(`${flag} requires a value\n\n${usage()}`);
  return value;
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) die(`${flag} must be a positive integer`);
  return value;
}

function parseNonNegativeInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) die(`${flag} must be a non-negative integer`);
  return value;
}

function parseDateBound(raw: string, endOfDay: boolean): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) die(`Invalid date: ${raw}`);
  return date;
}

function parseStatus(raw: string): "ok" | "failed" | number {
  if (raw === "ok" || raw === "failed") return raw;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) die(`Invalid status: ${raw}`);
  return value;
}

function parseFormat(raw: string): HistoryFormat {
  if (raw === "table" || raw === "json" || raw === "jsonl" || raw === "fzf") return raw;
  die(`Invalid history format: ${raw}`);
}

function parseListArgs(args: string[], initialQuery?: string): ParsedHistoryArgs {
  const parsed: ParsedHistoryArgs = {
    format: "table",
    all: false,
    query: initialQuery,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--json" || arg === "--json-output") {
      parsed.format = "json";
    } else if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveInt(readValue(args, i, arg), arg);
      i++;
    } else if (arg.startsWith("--limit=")) {
      parsed.limit = parsePositiveInt(arg.slice("--limit=".length), "--limit");
    } else if (arg === "--offset") {
      parsed.offset = parseNonNegativeInt(readValue(args, i, arg), arg);
      i++;
    } else if (arg.startsWith("--offset=")) {
      parsed.offset = parseNonNegativeInt(arg.slice("--offset=".length), "--offset");
    } else if (arg === "--page") {
      parsed.page = parsePositiveInt(readValue(args, i, arg), arg);
      i++;
    } else if (arg.startsWith("--page=")) {
      parsed.page = parsePositiveInt(arg.slice("--page=".length), "--page");
    } else if (arg === "--page-size") {
      parsed.pageSize = parsePositiveInt(readValue(args, i, arg), arg);
      i++;
    } else if (arg.startsWith("--page-size=")) {
      parsed.pageSize = parsePositiveInt(arg.slice("--page-size=".length), "--page-size");
    } else if (arg === "--format") {
      parsed.format = parseFormat(readValue(args, i, arg));
      i++;
    } else if (arg.startsWith("--format=")) {
      parsed.format = parseFormat(arg.slice("--format=".length));
    } else if (arg === "--query") {
      parsed.query = readValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--query=")) {
      parsed.query = arg.slice("--query=".length);
    } else if (arg === "--target") {
      parsed.target = readValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--target=")) {
      parsed.target = arg.slice("--target=".length);
    } else if (arg === "--type") {
      parsed.targetType = readValue(args, i, arg);
      i++;
    } else if (arg.startsWith("--type=")) {
      parsed.targetType = arg.slice("--type=".length);
    } else if (arg === "--status") {
      parsed.status = parseStatus(readValue(args, i, arg));
      i++;
    } else if (arg.startsWith("--status=")) {
      parsed.status = parseStatus(arg.slice("--status=".length));
    } else if (arg === "--since") {
      parsed.since = parseDateBound(readValue(args, i, arg), false);
      i++;
    } else if (arg.startsWith("--since=")) {
      parsed.since = parseDateBound(arg.slice("--since=".length), false);
    } else if (arg === "--until") {
      parsed.until = parseDateBound(readValue(args, i, arg), true);
      i++;
    } else if (arg.startsWith("--until=")) {
      parsed.until = parseDateBound(arg.slice("--until=".length), true);
    } else {
      die(`Unknown history option: ${arg}\n\n${usage()}`);
    }
  }

  const pageSize = parsed.pageSize ?? parsed.limit ?? DEFAULT_LIMIT;
  if (parsed.page !== undefined) {
    parsed.limit = pageSize;
    parsed.offset = (parsed.page - 1) * pageSize;
  } else if (!parsed.all && parsed.limit === undefined) {
    parsed.limit = DEFAULT_LIMIT;
  }
  if (parsed.all) parsed.limit = undefined;

  return parsed;
}

function formatLocalTimestamp(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function statusText(exitCode: number): string {
  return exitCode === 0 ? "ok" : `err:${exitCode}`;
}

function formatTable(result: HistoryQueryResult): string {
  if (result.records.length === 0) return "No history records.";
  const start = result.offset + 1;
  const end = result.offset + result.records.length;
  const lines = [`Showing ${start}-${end} of ${result.total}`, ""];
  lines.push(
    `${"ID".padEnd(10)} ${"WHEN".padEnd(19)} ${"STATUS".padEnd(6)} ${"MS".padEnd(6)} ${"TARGET".padEnd(22)} ${"COMMAND".padEnd(34)} ARGS`,
  );
  for (const record of result.records) {
    const summary = summarizeHistoryRecord(record);
    lines.push(
      [
        shortId(record.id).padEnd(10),
        formatLocalTimestamp(record.ts).padEnd(19),
        statusText(record.result.exitCode).padEnd(6),
        String(record.result.durationMs).padEnd(6),
        summary.target.padEnd(22),
        summary.command.padEnd(34),
        summary.args || "-",
      ].join(" "),
    );
  }
  return lines.join("\n");
}

function formatFzf(records: HistoryRecord[]): string {
  return records
    .map((record) => {
      const summary = summarizeHistoryRecord(record);
      return [
        record.id,
        formatLocalTimestamp(record.ts),
        statusText(record.result.exitCode),
        record.result.durationMs,
        summary.target,
        summary.command,
        summary.args,
        record.process.cwd,
      ].join("\t");
    })
    .join("\n");
}

function printList(opts: ParsedHistoryArgs): void {
  const { format, all: _all, page: _page, pageSize: _pageSize, ...query } = opts;
  const result = queryHistory(query);
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (format === "jsonl") {
    for (const record of result.records) console.log(JSON.stringify(record));
    return;
  }
  if (format === "fzf") {
    const text = formatFzf(result.records);
    if (text) console.log(text);
    return;
  }
  console.log(formatTable(result));
}

function runShow(args: string[]): void {
  const id = args[0];
  if (!id) die("Usage: clip history show <id-prefix> [--json]");
  const json = args.includes("--json");
  const record = findHistoryRecord(id);
  if (!record) die(`History record not found or ambiguous: ${id}`);
  if (json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  const summary = summarizeHistoryRecord(record);
  console.log(
    [
      `id:      ${record.id}`,
      `time:    ${formatLocalTimestamp(record.ts)}`,
      `target:  ${summary.target}`,
      `action:  ${summary.action}`,
      `status:  ${statusText(record.result.exitCode)} (${record.result.durationMs}ms)`,
      `cwd:     ${record.process.cwd}`,
      `summary: ${formatHistoryCommand(record)}`,
      `command: ${formatHistoryFullCommand(record)}`,
      "",
      JSON.stringify(record, null, 2),
    ].join("\n"),
  );
}

function runPick(args: string[]): void {
  const opts = parseListArgs(args);
  const { format: _format, all: _all, page: _page, pageSize: _pageSize, ...query } = opts;
  const input = formatFzf(queryHistory(query).records);
  if (!input) {
    console.log("No history records.");
    return;
  }

  const result = spawnSync(
    "fzf",
    [
      "--delimiter",
      "\t",
      "--with-nth",
      "2..",
      "--preview",
      "clip history show {1}",
      "--preview-window",
      "right:60%:wrap",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] },
  );

  if (result.error) {
    die("fzf not found. Install fzf or use: clip history --format fzf --all | fzf --delimiter=$'\\t' --with-nth=2..");
  }
  if (result.status === 130 || result.status === 1) return;
  if (result.status !== 0) die(`fzf failed with exit code ${result.status ?? 1}`);

  const selectedId = result.stdout.split("\t")[0]?.trim();
  if (selectedId) runShow([selectedId]);
}

function looksLikeIdPrefix(value: string): boolean {
  return /^[0-9a-f]{4,}(?:-[0-9a-f-]*)?$/i.test(value);
}

async function runHistoryCmd(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const subcommand = args[0] ?? "list";
  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(usage());
    return;
  }
  if (subcommand === "path") {
    console.log(historyDir(CONFIG_DIR));
    return;
  }
  if (subcommand === "show") {
    runShow(args.slice(1));
    return;
  }
  if (subcommand === "pick") {
    runPick(args.slice(1));
    return;
  }
  if (subcommand === "search") {
    const query = args[1];
    if (!query) die("Usage: clip history search <query> [filters...]");
    printList(parseListArgs(args.slice(2), query));
    return;
  }
  if (subcommand === "list") {
    printList(parseListArgs(args.slice(1)));
    return;
  }
  if (looksLikeIdPrefix(subcommand)) {
    runShow(args);
    return;
  }
  printList(parseListArgs(args));
}

function zshCompletion(): string {
  return `
  local _clip_cmd="\${words[1]}"
  local -a subcmds=(
    'list:list recent history records'
    'search:search history records'
    'show:show full record details by id'
    'pick:select a record with fzf and show details'
    'path:print history storage directory'
  )
  local -a opts=(
    '--limit[number of records]'
    '--offset[offset into records]'
    '--page[page number]'
    '--page-size[records per page]'
    '--target[target name]'
    '--type[target type]'
    '--status[ok, failed, or exit code]'
    '--since[start date]'
    '--until[end date]'
    '--format[output format]:format:(table json jsonl fzf)'
    '--json[output JSON]'
    '--all[show all records]'
  )

  _clip_history_records() {
    local -a records=()
    local line id when status ms target command args cwd short desc
    while IFS=$'\\t' read -r id when status ms target command args cwd; do
      [[ -z "$id" ]] && continue
      short="\${id[1,8]}"
      desc="$when $status $target $command"
      [[ -n "$args" ]] && desc="$desc $args"
      desc="\${desc//:/ -}"
      records+=("$short:$desc")
    done < <("$_clip_cmd" history --format fzf --limit 100 2>/dev/null)
    (( \${#records} )) && _describe -t history-records 'history records' records
  }

  if (( CURRENT == 3 )); then
    _clip_history_records
    _describe -t history-commands 'history commands' subcmds
    _describe -t history-options 'history options' opts
  elif (( CURRENT == 4 && "\${words[3]}" == "show" )); then
    _clip_history_records
  elif (( CURRENT >= 4 )); then
    _describe -t history-options 'history options' opts
  fi`;
}

export const extension: ClipExtension = {
  name: "history",
  init(api) {
    api.registerInternalCommand(
      "history",
      async ({ args }) => {
        await runHistoryCmd(args);
      },
      {
        description: "list local clip history",
        completion: zshCompletion,
      },
    );

    api.registerHook("cli-end", (ctx: CliHookCtx) => {
      recordCliEnd(ctx);
    });
  },
};
