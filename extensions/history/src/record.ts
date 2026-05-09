import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "@clip/core";
import type { CliCommandSummary, CommandHookCtx } from "@clip/core";

export type HistoryRecord = {
  schemaVersion: 1;
  id: string;
  ts: string;
  process: {
    pid: number;
    ppid: number;
    cwd: string;
    stdinTTY: boolean;
    stdoutTTY: boolean;
    stderrTTY: boolean;
  };
  command: CliCommandSummary;
  result: {
    exitCode: number;
    durationMs: number;
    stdoutBytes?: number;
    stderrBytes?: number;
  };
  error?: {
    name: string;
    message: string;
  };
  redaction?: {
    argv: number;
  };
};

export type HistoryQueryOptions = {
  limit?: number;
  offset?: number;
  since?: Date;
  until?: Date;
  query?: string;
  target?: string;
  targetType?: string;
  status?: "ok" | "failed" | number;
};

export type HistoryQueryResult = {
  total: number;
  offset: number;
  limit?: number;
  records: HistoryRecord[];
};

type RedactedArgv = {
  argv: string[];
  redactions: number;
};

const SECRET_NAME_RE =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|pwd|token|authorization)/i;
const SECRET_KEY_VALUE_RE =
  /^([^=\s]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|pwd|token|authorization)[^=\s]*=)(.+)$/i;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}\b/g;
const BASIC_RE = /\b(Basic\s+)[A-Za-z0-9+/=]{12,}\b/g;
const TOKEN_RE =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKI[AP][A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;

export function historyDir(rootDir = CONFIG_DIR): string {
  return join(rootDir, "history");
}

function localDatePartition(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function historyFilePath(record: HistoryRecord, rootDir = CONFIG_DIR): string {
  return join(historyDir(rootDir), `${localDatePartition(new Date(record.ts))}.jsonl`);
}

function redactInlineSecret(value: string): { value: string; redactions: number } {
  let redactions = 0;
  let next = value.replace(SECRET_KEY_VALUE_RE, (_match, prefix: string) => {
    redactions++;
    return `${prefix}[REDACTED]`;
  });
  next = next.replace(BEARER_RE, (_match, prefix: string) => {
    redactions++;
    return `${prefix}[REDACTED]`;
  });
  next = next.replace(BASIC_RE, (_match, prefix: string) => {
    redactions++;
    return `${prefix}[REDACTED]`;
  });
  next = next.replace(TOKEN_RE, () => {
    redactions++;
    return "[REDACTED]";
  });
  return { value: next, redactions };
}

export function redactArgv(argv: readonly string[]): RedactedArgv {
  const out: string[] = [];
  let redactions = 0;
  let redactNext = false;

  for (const arg of argv) {
    if (redactNext) {
      out.push("[REDACTED]");
      redactions++;
      redactNext = false;
      continue;
    }

    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0) {
      const key = arg.slice(0, eqIdx).replace(/^--?/, "");
      if (SECRET_NAME_RE.test(key)) {
        out.push(`${arg.slice(0, eqIdx + 1)}[REDACTED]`);
        redactions++;
        continue;
      }
    }

    const flagName = arg.replace(/^--?/, "");
    if (arg.startsWith("-") && SECRET_NAME_RE.test(flagName)) {
      out.push(arg);
      redactNext = true;
      continue;
    }

    const redacted = redactInlineSecret(arg);
    out.push(redacted.value);
    redactions += redacted.redactions;
  }

  return { argv: out, redactions };
}

function processInfo(): HistoryRecord["process"] {
  return {
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    stdinTTY: Boolean(process.stdin.isTTY),
    stdoutTTY: Boolean(process.stdout.isTTY),
    stderrTTY: Boolean(process.stderr.isTTY),
  };
}

function errorInfo(error: unknown): HistoryRecord["error"] | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function redactCommand(
  command: CliCommandSummary,
  redactedArgv: string[],
): { command: CliCommandSummary; redactions: number } {
  let redactions = 0;
  const redactList = (args: readonly string[]) => {
    const redacted = redactArgv(args);
    redactions += redacted.redactions;
    return redacted.argv;
  };

  if (command.kind === "command") {
    return { command: { ...command, argv: redactedArgv, args: redactList(command.args) }, redactions };
  }
  if (command.kind === "target") {
    return { command: { ...command, argv: redactedArgv, args: redactList(command.args) }, redactions };
  }
  return { command: { ...command, argv: redactedArgv } as CliCommandSummary, redactions };
}

export function recordCliEnd(ctx: CommandHookCtx, rootDir = CONFIG_DIR): void {
  if (ctx.phase !== "command-end" || !ctx.command) return;
  if (ctx.command.kind === "command" && ctx.command.name === "history") return;

  const redactedArgv = redactArgv(ctx.argv);
  const redactedCommand = redactCommand(ctx.command, redactedArgv.argv);
  const totalRedactions = redactedArgv.redactions + redactedCommand.redactions;

  appendHistoryRecord(
    {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      ts: ctx.startedAt,
      process: processInfo(),
      command: redactedCommand.command,
      result: {
        exitCode: ctx.exitCode ?? 1,
        durationMs: ctx.durationMs ?? 0,
        ...(ctx.result ? { stdoutBytes: Buffer.byteLength(ctx.result.stdout) } : {}),
        ...(ctx.result ? { stderrBytes: Buffer.byteLength(ctx.result.stderr) } : {}),
      },
      ...(ctx.error ? { error: errorInfo(ctx.error) } : {}),
      ...(totalRedactions > 0 ? { redaction: { argv: totalRedactions } } : {}),
    },
    rootDir,
  );
}

export function appendHistoryRecord(record: HistoryRecord, rootDir = CONFIG_DIR): void {
  const dir = historyDir(rootDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(historyFilePath(record, rootDir), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function readHistoryFile(path: string): HistoryRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as HistoryRecord];
      } catch {
        return [];
      }
    });
}

function listHistoryFiles(rootDir = CONFIG_DIR): string[] {
  const dir = historyDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .reverse()
    .map((name) => join(dir, name));
}

function commandText(record: HistoryRecord): string {
  return ["clip", ...record.command.argv].join(" ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

const VALUE_FLAGS = new Set([
  "--arg",
  "--args",
  "--args-json",
  "--body",
  "--data",
  "--env",
  "--header",
  "--headers",
  "--input",
  "--input-json",
  "--metadata",
  "--multipart-file",
  "--query",
  "--variables",
]);

function summarizeJsonValue(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return `[${parsed.length} items]`;
    if (parsed !== null && typeof parsed === "object") {
      const keys = Object.keys(parsed);
      const shown = keys.slice(0, 4).join(",");
      return `{${shown}${keys.length > 4 ? ",..." : ""}}`;
    }
    if (typeof parsed === "string") return JSON.stringify(truncate(parsed, 32));
    return String(parsed);
  } catch {
    return undefined;
  }
}

function summarizeValue(raw: string): string {
  return summarizeJsonValue(raw) ?? truncate(raw.replace(/\s+/g, " "), 48);
}

function summarizeToken(token: string): string {
  const eqIdx = token.indexOf("=");
  if (eqIdx > 0) {
    const key = token.slice(0, eqIdx);
    if (VALUE_FLAGS.has(key)) return `${key}=${summarizeValue(token.slice(eqIdx + 1))}`;
  }
  return summarizeJsonValue(token) ?? truncate(token, 40);
}

function summarizeTokens(tokens: readonly string[], maxLength = 96): string {
  const parts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (VALUE_FLAGS.has(token)) {
      const next = tokens[i + 1];
      parts.push(next ? `${token} ${summarizeValue(next)}` : token);
      i++;
      continue;
    }
    parts.push(summarizeToken(token));
  }

  return truncate(parts.join(" "), maxLength);
}

export type HistorySummary = {
  target: string;
  action: string;
  args: string;
  command: string;
};

export function summarizeHistoryRecord(record: HistoryRecord): HistorySummary {
  const command = record.command;
  if (command.kind === "command") {
    const args = summarizeTokens(command.args, 72);
    return {
      target: "command",
      action: command.name,
      args,
      command: ["clip", command.name].join(" "),
    };
  }
  if (command.kind === "target") {
    const flagTokens = [
      ...(command.dryRun ? ["--dry-run"] : []),
      ...(command.jsonMode ? ["--json"] : []),
      ...(command.pipeMode ? ["--pipe"] : []),
    ];
    const args = summarizeTokens([...command.args, ...flagTokens], 72);
    const action = command.subcommand ?? "(target)";
    return {
      target: `${command.targetType ?? "target"}/${command.target}`,
      action,
      args,
      command: ["clip", command.token || command.target, action].filter(Boolean).join(" "),
    };
  }

  return {
    target: "clip",
    action: command.kind,
    args: "",
    command: truncate(commandText(record), 96),
  };
}

function matchesQuery(record: HistoryRecord, query: string): boolean {
  const q = query.toLowerCase();
  const command = record.command;
  const haystack = [
    record.id,
    record.ts,
    record.process.cwd,
    commandText(record),
    command.kind,
    command.kind === "command" ? command.name : undefined,
    command.kind === "target" ? command.target : undefined,
    command.kind === "target" ? command.targetType : undefined,
    command.kind === "target" ? command.subcommand : undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matches(record: HistoryRecord, opts: HistoryQueryOptions): boolean {
  const ts = Date.parse(record.ts);
  if (opts.since && ts < opts.since.getTime()) return false;
  if (opts.until && ts > opts.until.getTime()) return false;
  if (opts.query && !matchesQuery(record, opts.query)) return false;
  if (opts.status === "ok" && record.result.exitCode !== 0) return false;
  if (opts.status === "failed" && record.result.exitCode === 0) return false;
  if (typeof opts.status === "number" && record.result.exitCode !== opts.status) return false;
  if (opts.target) {
    if (record.command.kind !== "target" || record.command.target !== opts.target) return false;
  }
  if (opts.targetType) {
    if (record.command.kind !== "target" || record.command.targetType !== opts.targetType) return false;
  }
  return true;
}

export function queryHistory(opts: HistoryQueryOptions = {}, rootDir = CONFIG_DIR): HistoryQueryResult {
  const all = listHistoryFiles(rootDir)
    .flatMap((path) => readHistoryFile(path))
    .filter((record) => matches(record, opts))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  const offset = Math.max(0, opts.offset ?? 0);
  const records = opts.limit === undefined ? all.slice(offset) : all.slice(offset, offset + opts.limit);
  return { total: all.length, offset, ...(opts.limit !== undefined ? { limit: opts.limit } : {}), records };
}

export function findHistoryRecord(idOrPrefix: string, rootDir = CONFIG_DIR): HistoryRecord | undefined {
  const matches = queryHistory({ limit: undefined }, rootDir).records.filter((record) =>
    record.id.startsWith(idOrPrefix),
  );
  return matches.length === 1 ? matches[0] : matches.find((record) => record.id === idOrPrefix);
}

export function formatHistoryCommand(record: HistoryRecord): string {
  return summarizeHistoryRecord(record).command;
}

export function formatHistoryFullCommand(record: HistoryRecord): string {
  return commandText(record);
}
