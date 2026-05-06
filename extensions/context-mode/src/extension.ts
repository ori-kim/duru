import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipExtension, HookCtx, TargetResult } from "@clip/core";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

type ContextMode = "off" | "auto" | "always";
type StorageMode = "auto" | "isolated" | "harness";
type JsonChunkMode = "batch" | "object";
type OverrideMode = "off" | "auto" | "always" | undefined;

type TargetConfig = {
  enabled?: boolean;
  mode?: ContextMode;
  thresholdBytes?: number;
  previewBytes?: number;
  includeStderr?: boolean;
  jsonChunkMode?: JsonChunkMode;
};

type ExtensionConfig = {
  mcp?: {
    command?: string | string[];
    timeoutMs?: number;
  };
  storage?: {
    mode?: StorageMode;
  };
  defaults?: {
    mode?: ContextMode;
    thresholdBytes?: number;
    previewBytes?: number;
    includeStderr?: boolean;
    jsonChunkMode?: JsonChunkMode;
  };
  targets?: Record<string, TargetConfig>;
};

type SourceRecord = {
  label: string;
  target: string;
  command: string;
  bytes: number;
  exitCode: number;
  indexedAt: string;
  cwd: string;
  indexer?: "ctx_index" | "ctx_index_json_markdown";
};

type ParsedContextFlag = {
  override: OverrideMode;
  jsonChunkMode?: JsonChunkMode;
  args: string[];
  changed: boolean;
};

type EffectivePolicy = {
  enabled: boolean;
  mode: ContextMode;
  thresholdBytes: number;
  previewBytes: number;
  includeStderr: boolean;
  jsonChunkMode: JsonChunkMode;
};

type McpMessage = {
  jsonrpc?: "2.0";
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

const CLIP_HOME = process.env.CLIP_HOME || join(homedir(), ".clip");
const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const EXT_DIR = join(CLIP_HOME, "extensions", "context-mode");
const STATE_DIR = join(CLIP_HOME, "context-mode");
const CONFIG_PATH = join(STATE_DIR, "config.yml");
const SOURCES_PATH = join(STATE_DIR, "sources.json");
const BYPASS_ENV = "CLIP_CONTEXT_MODE_BYPASS";

const DEFAULTS = {
  mode: "auto" as ContextMode,
  thresholdBytes: 20_000,
  previewBytes: 3_000,
  includeStderr: true,
  jsonChunkMode: "object" as JsonChunkMode,
  jsonMaxChunkBytes: 4096,
  timeoutMs: 15_000,
};

const PLATFORM_ENV_VARS: Array<[string, string[]]> = [
  ["claude-code", ["CLAUDE_PROJECT_DIR", "CLAUDE_SESSION_ID"]],
  ["antigravity", ["ANTIGRAVITY_CLI_ALIAS"]],
  ["cursor", ["CURSOR_TRACE_ID", "CURSOR_CLI"]],
  ["kilo", ["KILO_PID"]],
  ["opencode", ["OPENCODE", "OPENCODE_PID"]],
  ["zed", ["ZED_SESSION_ID", "ZED_TERM"]],
  ["codex", ["CODEX_THREAD_ID", "CODEX_CI"]],
  ["gemini-cli", ["GEMINI_PROJECT_DIR", "GEMINI_CLI"]],
  ["vscode-copilot", ["VSCODE_PID", "VSCODE_CWD"]],
  ["jetbrains-copilot", ["IDEA_INITIAL_DIRECTORY"]],
  ["qwen-code", ["QWEN_PROJECT_DIR"]],
  ["pi", ["PI_PROJECT_DIR"]],
];

const DEFAULT_PLATFORM_SEGMENTS = [".claude"];

const PLATFORM_SEGMENTS: Record<string, string[]> = {
  "claude-code": DEFAULT_PLATFORM_SEGMENTS,
  "gemini-cli": [".gemini"],
  antigravity: [".gemini"],
  openclaw: [".openclaw"],
  codex: [".codex"],
  cursor: [".cursor"],
  "vscode-copilot": [".vscode"],
  kiro: [".kiro"],
  pi: [".pi"],
  "qwen-code": [".qwen"],
  kilo: [".config", "kilo"],
  opencode: [".config", "opencode"],
  zed: [".config", "zed"],
  "jetbrains-copilot": [".config", "JetBrains"],
};

const PLATFORM_CONFIG_DIR_ORDER = [
  ["claude-code", [".claude"]],
  ["gemini-cli", [".gemini"]],
  ["codex", [".codex"]],
  ["cursor", [".cursor"]],
  ["kiro", [".kiro"]],
  ["pi", [".pi"]],
  ["qwen-code", [".qwen"]],
  ["openclaw", [".openclaw"]],
  ["kilo", [".config", "kilo"]],
  ["jetbrains-copilot", [".config", "JetBrains"]],
  ["opencode", [".config", "opencode"]],
  ["zed", [".config", "zed"]],
] as const;

let invocationOverride: OverrideMode;
let invocationJsonChunkMode: JsonChunkMode | undefined;

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true });
}

function defaultConfig(): ExtensionConfig {
  const mcp: NonNullable<ExtensionConfig["mcp"]> = { timeoutMs: DEFAULTS.timeoutMs };
  if (process.env.CLIP_CONTEXT_MODE_COMMAND) {
    mcp.command = process.env.CLIP_CONTEXT_MODE_COMMAND;
  }

  return {
    mcp,
    storage: { mode: "auto" },
    defaults: {
      mode: DEFAULTS.mode,
      thresholdBytes: DEFAULTS.thresholdBytes,
      previewBytes: DEFAULTS.previewBytes,
      includeStderr: DEFAULTS.includeStderr,
      jsonChunkMode: DEFAULTS.jsonChunkMode,
    },
    targets: {},
  };
}

function readConfig(): ExtensionConfig {
  if (!existsSync(CONFIG_PATH)) return defaultConfig();
  try {
    const parsed = yamlParse(readFileSync(CONFIG_PATH, "utf8")) as ExtensionConfig | null;
    const base = defaultConfig();
    return {
      ...base,
      ...(parsed ?? {}),
      mcp: { ...base.mcp, ...(parsed?.mcp ?? {}) },
      storage: { ...base.storage, ...(parsed?.storage ?? {}) },
      defaults: { ...base.defaults, ...(parsed?.defaults ?? {}) },
      targets: { ...(parsed?.targets ?? {}) },
    };
  } catch {
    return defaultConfig();
  }
}

function writeConfig(config: ExtensionConfig): void {
  ensureStateDir();
  writeFileSync(CONFIG_PATH, yamlStringify(config), "utf8");
}

function readSourceRecords(): SourceRecord[] {
  if (!existsSync(SOURCES_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
    return Array.isArray(raw) ? (raw as SourceRecord[]) : [];
  } catch {
    return [];
  }
}

function writeSourceRecord(record: SourceRecord): void {
  ensureStateDir();
  const records = readSourceRecords().filter((r) => r.label !== record.label);
  records.unshift(record);
  writeFileSync(SOURCES_PATH, `${JSON.stringify(records.slice(0, 500), null, 2)}\n`, "utf8");
}

function normalizeTargetName(target: string): string {
  return target.split("@")[0] || target;
}

function getTargetConfig(config: ExtensionConfig, target: string): TargetConfig | undefined {
  return config.targets?.[target] ?? config.targets?.[normalizeTargetName(target)];
}

function effectivePolicy(
  config: ExtensionConfig,
  target: string,
  override: OverrideMode,
  jsonChunkModeOverride?: JsonChunkMode,
): EffectivePolicy {
  const defaults = config.defaults ?? {};
  const targetConfig = getTargetConfig(config, target) ?? {};
  const defaultMode = defaults.mode ?? DEFAULTS.mode;
  const mode = override === "always" ? "always" : override === "auto" ? "auto" : (targetConfig.mode ?? defaultMode);
  const jsonChunkMode =
    jsonChunkModeOverride ?? targetConfig.jsonChunkMode ?? defaults.jsonChunkMode ?? DEFAULTS.jsonChunkMode;

  if (override === "off") {
    return {
      enabled: false,
      mode: "off",
      thresholdBytes: targetConfig.thresholdBytes ?? defaults.thresholdBytes ?? DEFAULTS.thresholdBytes,
      previewBytes: targetConfig.previewBytes ?? defaults.previewBytes ?? DEFAULTS.previewBytes,
      includeStderr: targetConfig.includeStderr ?? defaults.includeStderr ?? DEFAULTS.includeStderr,
      jsonChunkMode,
    };
  }

  const enabled = override === "always" || override === "auto" || targetConfig.enabled === true;
  return {
    enabled: enabled && mode !== "off",
    mode,
    thresholdBytes: targetConfig.thresholdBytes ?? defaults.thresholdBytes ?? DEFAULTS.thresholdBytes,
    previewBytes: targetConfig.previewBytes ?? defaults.previewBytes ?? DEFAULTS.previewBytes,
    includeStderr: targetConfig.includeStderr ?? defaults.includeStderr ?? DEFAULTS.includeStderr,
    jsonChunkMode,
  };
}

function parseContextValue(value: string | undefined): OverrideMode {
  if (!value) return "auto";
  const v = value.toLowerCase();
  if (["off", "raw", "false", "no", "0"].includes(v)) return "off";
  if (["always", "force", "forced"].includes(v)) return "always";
  if (["auto", "on", "true", "yes", "1"].includes(v)) return "auto";
  return undefined;
}

function parseJsonChunkMode(value: string | undefined): JsonChunkMode | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (["1", "batch", "batched", "original", "context-mode"].includes(v)) return "batch";
  if (["2", "object", "objects", "row", "rows", "entity", "entities"].includes(v)) return "object";
  return undefined;
}

function extractContextFlag(args: readonly string[]): ParsedContextFlag {
  const out: string[] = [];
  let override: OverrideMode;
  let jsonChunkMode: JsonChunkMode | undefined;
  let changed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--context-mode") {
      override = "always";
      changed = true;
      continue;
    }
    if (arg === "--no-context-mode") {
      override = "off";
      changed = true;
      continue;
    }
    if (arg.startsWith("--context-mode=")) {
      override = parseContextValue(arg.slice("--context-mode=".length)) ?? "always";
      changed = true;
      continue;
    }
    if (arg === "--context") {
      override = parseContextValue(args[i + 1]);
      i++;
      changed = true;
      continue;
    }
    if (arg.startsWith("--context=")) {
      override = parseContextValue(arg.slice("--context=".length));
      changed = true;
      continue;
    }
    if (arg === "--json-chunk-mode") {
      jsonChunkMode = parseJsonChunkMode(args[i + 1]);
      i++;
      changed = true;
      continue;
    }
    if (arg.startsWith("--json-chunk-mode=")) {
      jsonChunkMode = parseJsonChunkMode(arg.slice("--json-chunk-mode=".length));
      changed = true;
      continue;
    }
    out.push(arg);
  }

  return { override, jsonChunkMode, args: out, changed };
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  const buffer = Buffer.from(text, "utf8");
  return `${buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8")}\n...[truncated]`;
}

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@,+#]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function commandText(subcommand: string, args: readonly string[]): string {
  return [subcommand, ...args].join(" ").trim();
}

function sourceLabel(ctx: Pick<HookCtx, "targetName" | "subcommand">, args: readonly string[]): string {
  const target = normalizeTargetName(ctx.targetName);
  const cmd = commandText(ctx.subcommand, args).replace(/\s+/g, " ").trim();
  const hash = createHash("sha256").update([process.cwd(), ctx.targetName, cmd].join("\0")).digest("hex").slice(0, 10);
  const shortCmd = cmd.slice(0, 90) || ctx.subcommand;
  return `clip:${target}:${shortCmd}#${hash}`;
}

function buildIndexContent(
  ctx: HookCtx,
  result: TargetResult,
  args: readonly string[],
  includeStderr: boolean,
): string {
  const parts = [
    `# clip ${ctx.targetName} ${commandText(ctx.subcommand, args)}`,
    "",
    `target: ${ctx.targetName}`,
    `target_type: ${ctx.targetType}`,
    `exit_code: ${result.exitCode}`,
    `cwd: ${process.cwd()}`,
    `captured_at: ${new Date().toISOString()}`,
    "",
  ];

  if (result.stdout) {
    parts.push("## stdout", "", "```text", result.stdout, "```", "");
  }
  if (includeStderr && result.stderr) {
    parts.push("## stderr", "", "```text", result.stderr, "```", "");
  }

  return parts.join("\n");
}

function parseJsonOutput(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function markdownTitle(path: string[]): string {
  return (path.length > 0 ? path.join(" > ") : "(root)").replace(/\s+/g, " ").trim();
}

function addJsonSection(parts: string[], title: string, value: unknown): void {
  parts.push(`## ${title}`, "", "```json", JSON.stringify(value, null, 2), "```", "");
}

function findIdentityField(items: unknown[]): string | null {
  const first = items[0];
  if (!isRecord(first)) return null;

  const candidates = ["id", "name", "title", "path", "slug", "key", "label", "code"];
  for (const field of candidates) {
    const value = first[field];
    if (typeof value === "string" || typeof value === "number") return field;
  }
  return null;
}

function jsonBatchTitle(
  prefix: string,
  start: number,
  end: number,
  batch: unknown[],
  identityField: string | null,
): string {
  const sep = prefix ? `${prefix} > ` : "";
  if (!identityField) return start === end ? `${sep}[${start}]` : `${sep}[${start}-${end}]`;

  const identity = (item: unknown) => String((item as Record<string, unknown>)[identityField]);
  if (batch.length === 1) return `${sep}${identity(batch[0])}`;
  if (batch.length <= 3) return sep + batch.map(identity).join(", ");
  return `${sep}${identity(batch[0])}...${identity(batch[batch.length - 1])}`;
}

function jsonObjectTitle(prefix: string, index: number, value: unknown): string {
  const sep = prefix ? `${prefix} > ` : "";
  if (!isRecord(value)) return `${sep}[${index}]`;

  const code = value.code ?? value.id ?? value.key;
  const name = value.name ?? value.title ?? value.label ?? value.slug;
  const fullName = value.full_name ?? value.fullName ?? value.path;
  const pieces = [code, name].filter((v) => typeof v === "string" || typeof v === "number").map(String);
  if (typeof fullName === "string" && fullName && !pieces.includes(fullName)) {
    pieces.push(fullName);
  }

  return `${sep}${pieces.length > 0 ? pieces.join(" - ") : `[${index}]`}`;
}

function addJsonObjectSection(parts: string[], title: string, value: unknown): void {
  parts.push(`## ${title}`, "");
  if (isRecord(value)) {
    for (const key of [
      "code",
      "id",
      "key",
      "name",
      "title",
      "label",
      "full_name",
      "fullName",
      "path",
      "parent_code",
      "parentCode",
    ]) {
      const v = value[key];
      if (typeof v === "string" || typeof v === "number") {
        parts.push(`${key}: ${v}`);
      }
    }
    parts.push("");
  }
  parts.push("```json", JSON.stringify(value, null, 2), "```", "");
}

function walkJsonAsMarkdown(
  value: unknown,
  path: string[],
  parts: string[],
  maxChunkBytes: number,
  mode: JsonChunkMode,
): void {
  const title = markdownTitle(path);
  const serializedBytes = jsonBytes(value);

  if (serializedBytes <= maxChunkBytes) {
    const shouldRecurse =
      isRecord(value) && Object.values(value).some((child) => typeof child === "object" && child !== null);

    if (!shouldRecurse) {
      addJsonSection(parts, title, value);
      return;
    }
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      addJsonSection(parts, title, value);
      return;
    }
    for (const [key, child] of entries) {
      walkJsonAsMarkdown(child, [...path, key], parts, maxChunkBytes, mode);
    }
    return;
  }

  if (Array.isArray(value)) {
    const prefix = markdownTitle(path);
    if (mode === "object" && value.some(isRecord)) {
      for (let i = 0; i < value.length; i++) {
        addJsonObjectSection(parts, jsonObjectTitle(prefix, i, value[i]), value[i]);
      }
      return;
    }

    const identityField = findIdentityField(value);
    let batch: unknown[] = [];
    let batchStart = 0;

    const flush = (batchEnd: number) => {
      if (batch.length === 0) return;
      addJsonSection(parts, jsonBatchTitle(prefix, batchStart, batchEnd, batch, identityField), batch);
    };

    for (let i = 0; i < value.length; i++) {
      batch.push(value[i]);
      if (jsonBytes(batch) > maxChunkBytes && batch.length > 1) {
        batch.pop();
        flush(i - 1);
        batch = [value[i]];
        batchStart = i;
      }
    }
    flush(batchStart + batch.length - 1);
    return;
  }

  addJsonSection(parts, title, value);
}

function buildJsonIndexContent(
  ctx: HookCtx,
  result: TargetResult,
  args: readonly string[],
  includeStderr: boolean,
  jsonChunkMode: JsonChunkMode,
): string | undefined {
  const parsed = parseJsonOutput(result.stdout);
  if (parsed === undefined) return undefined;

  const parts = [
    `# clip ${ctx.targetName} ${commandText(ctx.subcommand, args)}`,
    "",
    `target: ${ctx.targetName}`,
    `target_type: ${ctx.targetType}`,
    `exit_code: ${result.exitCode}`,
    `cwd: ${process.cwd()}`,
    `captured_at: ${new Date().toISOString()}`,
    "adapter: json-to-markdown",
    `json_chunk_mode: ${jsonChunkMode}`,
    "",
  ];

  walkJsonAsMarkdown(parsed, ["stdout"], parts, DEFAULTS.jsonMaxChunkBytes, jsonChunkMode);

  if (includeStderr && result.stderr) {
    parts.push("## stderr", "", "```text", result.stderr, "```", "");
  }

  return parts.join("\n");
}

function combinedPreview(result: TargetResult, includeStderr: boolean): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (includeStderr && result.stderr) {
    parts.push(result.stdout ? `\n[stderr]\n${result.stderr}` : result.stderr);
  }
  return parts.join("");
}

function formatContextResult(params: {
  ctx: HookCtx;
  original: TargetResult;
  args: readonly string[];
  source: string;
  indexed: boolean;
  indexText: string;
  rawBytes: number;
  previewBytes: number;
  includeStderr: boolean;
  error?: string;
}): TargetResult {
  const preview = truncateBytes(combinedPreview(params.original, params.includeStderr), params.previewBytes);
  const rawCommand = `clip ${params.ctx.targetName} ${commandText(params.ctx.subcommand, params.args)} --context off`;
  const searchCommand = `clip ctx search "query" --target ${normalizeTargetName(params.ctx.targetName)}`;

  if (params.ctx.jsonMode) {
    return {
      exitCode: params.original.exitCode,
      stdout: JSON.stringify({
        contextMode: true,
        indexed: params.indexed,
        source: params.source,
        rawBytes: params.rawBytes,
        previewBytes: byteLength(preview),
        preview,
        searchCommand,
        rawCommand,
        indexResult: params.indexText,
        error: params.error,
      }),
      stderr: "",
    };
  }

  const lines = [
    params.error ? "[context-mode] indexing failed" : "[context-mode] indexed output",
    `source: ${params.source}`,
    `raw_bytes: ${params.rawBytes}`,
    `search: ${searchCommand}`,
    `raw: ${rawCommand}`,
  ];
  if (params.error) lines.push(`error: ${params.error}`);
  if (params.indexText.trim()) lines.push("", params.indexText.trim());
  if (preview.trim()) lines.push("", "Preview:", preview);

  return {
    exitCode: params.original.exitCode,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

function hasHarnessEnv(env: Record<string, string | undefined>): boolean {
  return PLATFORM_ENV_VARS.some(([, vars]) => vars.some((v) => !!env[v]));
}

function getProjectDir(env: Record<string, string | undefined> = process.env): string {
  return (
    env.CLAUDE_PROJECT_DIR ||
    env.GEMINI_PROJECT_DIR ||
    env.VSCODE_CWD ||
    env.OPENCODE_PROJECT_DIR ||
    env.PI_PROJECT_DIR ||
    env.IDEA_INITIAL_DIRECTORY ||
    env.QWEN_PROJECT_DIR ||
    env.CONTEXT_MODE_PROJECT_DIR ||
    process.cwd()
  );
}

function detectPlatformFromEnv(env: Record<string, string | undefined>, home: string): string {
  const override = env.CONTEXT_MODE_PLATFORM;
  if (override && PLATFORM_SEGMENTS[override]) return override;

  for (const [platform, vars] of PLATFORM_ENV_VARS) {
    if (vars.some((v) => !!env[v])) return platform;
  }

  for (const [platform, segments] of PLATFORM_CONFIG_DIR_ORDER) {
    if (existsSync(join(home, ...segments))) return platform;
  }

  return "claude-code";
}

function buildMcpEnv(config: ExtensionConfig): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const storageMode = config.storage?.mode ?? "auto";
  const useHarness = storageMode === "harness" || (storageMode === "auto" && hasHarnessEnv(env));
  env.CONTEXT_MODE_PROJECT_DIR = getProjectDir(env);

  if (!useHarness) {
    const home = join(STATE_DIR, "home");
    mkdirSync(home, { recursive: true });
    env.HOME = home;
    env.USERPROFILE = home;
    env.CONTEXT_MODE_PLATFORM = "claude-code";

    for (const [, vars] of PLATFORM_ENV_VARS) {
      for (const key of vars) delete env[key];
    }
  }

  return env;
}

function contextStorePath(config: ExtensionConfig): string {
  const env = buildMcpEnv(config);
  const home = env.HOME || homedir();
  const platform = detectPlatformFromEnv(env, home);
  const segments = PLATFORM_SEGMENTS[platform] ?? DEFAULT_PLATFORM_SEGMENTS;
  const projectDir = getProjectDir(env).replace(/\\/g, "/");
  const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 16);
  const sessionDir = join(home, ...segments, "context-mode", "sessions");
  return join(dirname(sessionDir), "content", `${hash}.db`);
}

function storageSummary(config: ExtensionConfig): string {
  const env = buildMcpEnv(config);
  const home = env.HOME || homedir();
  const platform = detectPlatformFromEnv(env, home);
  const mode = config.storage?.mode ?? "auto";
  const kind = mode === "auto" ? (hasHarnessEnv(process.env) ? "harness" : "isolated") : mode;
  return `${kind}/${platform}`;
}

function splitCommand(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function resolveMcpCommand(config: ExtensionConfig): string[] {
  const override = process.env.CLIP_CONTEXT_MODE_COMMAND;
  const configured = override || config.mcp?.command;
  if (Array.isArray(configured)) return configured;
  if (typeof configured === "string" && configured.trim()) return splitCommand(configured);

  const packageBin = join(PACKAGE_DIR, "node_modules", ".bin", "context-mode");
  if (existsSync(packageBin)) return [packageBin];

  const workspaceBin = join(PACKAGE_DIR, "..", "..", "node_modules", ".bin", "context-mode");
  if (existsSync(workspaceBin)) return [workspaceBin];

  const userBin = join(EXT_DIR, "node_modules", ".bin", "context-mode");
  if (existsSync(userBin)) return [userBin];

  return ["context-mode"];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error) => {
        clearTimeout(id);
        reject(error);
      },
    );
  });
}

async function callMcpTool(config: ExtensionConfig, name: string, args: Record<string, unknown>): Promise<string> {
  const command = resolveMcpCommand(config);
  const timeoutMs = config.mcp?.timeoutMs ?? DEFAULTS.timeoutMs;
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: buildMcpEnv(config),
    });
  } catch (error) {
    throw new Error(`cannot start context-mode MCP command ${JSON.stringify(command)}: ${error}`);
  }

  const decoder = new TextDecoder();
  const stdin = proc.stdin as unknown as {
    write: (chunk: string | Uint8Array) => unknown;
    end: () => unknown;
  };
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrText = "";

  const stderrPromise = new Response(proc.stderr as ReadableStream<Uint8Array>)
    .text()
    .then((text) => {
      stderrText = text;
    })
    .catch(() => {});

  const readLoop = (async () => {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stdoutBuffer += decoder.decode(value, { stream: true });
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf("\n");
        if (!line) continue;

        let message: McpMessage;
        try {
          message = JSON.parse(line) as McpMessage;
        } catch {
          continue;
        }
        if (typeof message.id !== "number") continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) {
          waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
        } else {
          waiter.resolve(message.result);
        }
      }
    }
  })().catch((error) => {
    for (const waiter of pending.values()) waiter.reject(error instanceof Error ? error : new Error(String(error)));
    pending.clear();
  });

  async function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    await Promise.resolve(stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
    return withTimeout(promise, timeoutMs, `MCP ${method}`);
  }

  async function notify(method: string, params?: unknown): Promise<void> {
    await Promise.resolve(stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`));
  }

  try {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clip-context-mode", version: "0.1.0" },
    });
    await notify("notifications/initialized", {});
    const result = await request("tools/call", { name, arguments: args });
    return extractMcpText(result);
  } finally {
    try {
      stdin.end();
    } catch {}
    try {
      proc.kill();
    } catch {}
    await Promise.race([readLoop, new Promise((resolve) => setTimeout(resolve, 100))]);
    await Promise.race([stderrPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
    if (pending.size > 0 && stderrText.trim()) {
      for (const waiter of pending.values()) waiter.reject(new Error(stderrText.trim()));
      pending.clear();
    }
  }
}

function extractMcpText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean })?.content;
  if (!Array.isArray(content)) return JSON.stringify(result, null, 2);
  return content
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n");
}

async function runClipBuffered(ctx: HookCtx, args: string[]): Promise<TargetResult> {
  const command = [
    "clip",
    "--pipe",
    ...(ctx.jsonMode ? ["--json-output"] : []),
    ...(ctx.dryRun ? ["--dry-run"] : []),
    ctx.targetName,
    ctx.subcommand,
    ...args,
  ];
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, [BYPASS_ENV]: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function applyContextMode(
  ctx: HookCtx,
  result: TargetResult,
  args: readonly string[],
  override: OverrideMode,
  jsonChunkModeOverride?: JsonChunkMode,
): Promise<TargetResult> {
  const config = readConfig();
  const policy = effectivePolicy(config, ctx.targetName, override, jsonChunkModeOverride);
  if (!policy.enabled) return result;
  if (ctx.dryRun && policy.mode !== "always") return result;

  const rawBytes = byteLength(result.stdout) + (policy.includeStderr ? byteLength(result.stderr) : 0);
  if (rawBytes === 0) return result;
  if (policy.mode === "auto" && rawBytes < policy.thresholdBytes) return result;

  const source = sourceLabel(ctx, args);
  const jsonContent = buildJsonIndexContent(ctx, result, args, policy.includeStderr, policy.jsonChunkMode);
  const content = jsonContent ?? buildIndexContent(ctx, result, args, policy.includeStderr);
  let indexed = false;
  let indexText = "";
  const indexer: SourceRecord["indexer"] = jsonContent ? "ctx_index_json_markdown" : "ctx_index";
  let error: string | undefined;

  try {
    indexText = await callMcpTool(config, "ctx_index", { content, source });
    if (jsonContent) indexText += `\nadapter: json-to-markdown\njson_chunk_mode: ${policy.jsonChunkMode}`;
    indexed = true;
    writeSourceRecord({
      label: source,
      target: ctx.targetName,
      command: commandText(ctx.subcommand, args),
      bytes: rawBytes,
      exitCode: result.exitCode,
      indexedAt: new Date().toISOString(),
      cwd: process.cwd(),
      indexer,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return formatContextResult({
    ctx,
    original: result,
    args,
    source,
    indexed,
    indexText,
    rawBytes,
    previewBytes: policy.previewBytes,
    includeStderr: policy.includeStderr,
    error,
  });
}

function parseOption(args: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === `--${name}`) {
      value = args[i + 1];
      i++;
    } else if (arg.startsWith(`--${name}=`)) {
      value = arg.slice(name.length + 3);
    } else {
      rest.push(arg);
    }
  }
  return { value, rest };
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function printContextUsage(): void {
  console.log(
    [
      "Usage:",
      "  clip context enable <target> [--mode auto|always] [--threshold bytes] [--preview bytes] [--json-chunk-mode object|batch]",
      "  clip context disable <target>",
      "  clip context status [target]",
      "  clip context doctor",
      "",
      "Per-call override:",
      "  clip <target> <command> ... --context-mode [--json-chunk-mode object|batch]",
      "  clip <target> <command> ... --context off|auto|always",
    ].join("\n"),
  );
}

async function handleContextCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    printContextUsage();
    return;
  }

  if (sub === "enable") {
    const target = args[1];
    if (!target) fail("Usage: clip context enable <target>");
    const config = readConfig();
    const mode = parseOption(args.slice(2), "mode").value as ContextMode | undefined;
    const threshold = parseOption(args.slice(2), "threshold").value;
    const preview = parseOption(args.slice(2), "preview").value;
    const jsonChunkMode = parseJsonChunkMode(parseOption(args.slice(2), "json-chunk-mode").value);
    config.targets ??= {};
    config.targets[target] = {
      ...(config.targets[target] ?? {}),
      enabled: true,
      ...(mode ? { mode } : {}),
      ...(threshold ? { thresholdBytes: Number(threshold) } : {}),
      ...(preview ? { previewBytes: Number(preview) } : {}),
      ...(jsonChunkMode ? { jsonChunkMode } : {}),
    };
    writeConfig(config);
    console.log(`context-mode enabled for ${target}`);
    return;
  }

  if (sub === "disable") {
    const target = args[1];
    if (!target) fail("Usage: clip context disable <target>");
    const config = readConfig();
    config.targets ??= {};
    config.targets[target] = { ...(config.targets[target] ?? {}), enabled: false };
    writeConfig(config);
    console.log(`context-mode disabled for ${target}`);
    return;
  }

  if (sub === "status") {
    const config = readConfig();
    const target = args[1];
    if (target) {
      const policy = effectivePolicy(config, target, undefined);
      const targetConfig = getTargetConfig(config, target);
      console.log(
        [
          `target: ${target}`,
          `enabled: ${targetConfig?.enabled === true}`,
          `mode: ${policy.mode}`,
          `threshold_bytes: ${policy.thresholdBytes}`,
          `preview_bytes: ${policy.previewBytes}`,
          `include_stderr: ${policy.includeStderr}`,
          `json_chunk_mode: ${policy.jsonChunkMode}`,
          `storage: ${storageSummary(config)}`,
          `content_db: ${contextStorePath(config)}`,
          `mcp_command: ${resolveMcpCommand(config).map(shellQuote).join(" ")}`,
        ].join("\n"),
      );
      return;
    }

    const targets = Object.entries(config.targets ?? {});
    if (targets.length === 0) {
      console.log("No context-mode targets configured.");
      return;
    }
    for (const [name, value] of targets) {
      const policy = effectivePolicy(config, name, undefined);
      console.log(
        `${name}\t${value.enabled ? "enabled" : "disabled"}\t${policy.mode}\tthreshold=${policy.thresholdBytes}\tjson=${policy.jsonChunkMode}`,
      );
    }
    return;
  }

  if (sub === "doctor") {
    const config = readConfig();
    console.log(
      [
        `config: ${CONFIG_PATH}`,
        `storage: ${storageSummary(config)}`,
        `content_db: ${contextStorePath(config)}`,
        `mcp_command: ${resolveMcpCommand(config).map(shellQuote).join(" ")}`,
        "",
        await callMcpTool(config, "ctx_doctor", {}),
      ].join("\n"),
    );
    return;
  }

  printContextUsage();
}

function printCtxUsage(): void {
  console.log(
    [
      "Usage:",
      "  clip ctx search <query> [--target target] [--limit n] [--all]",
      "  clip ctx sources [--target target]",
      "  clip ctx purge [--target target] --yes",
      "  clip ctx stats",
      "  clip ctx doctor",
    ].join("\n"),
  );
}

async function handleCtxCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    printCtxUsage();
    return;
  }

  const config = readConfig();

  if (sub === "search") {
    const all = args.includes("--all");
    const searchArgs = args.slice(1).filter((a) => a !== "--all");
    const targetOpt = parseOption(searchArgs, "target");
    const limitOpt = parseOption(targetOpt.rest, "limit");
    const query = limitOpt.rest.join(" ").trim();
    if (!query) fail("Usage: clip ctx search <query> [--target target] [--limit n]");
    if (all) {
      process.stdout.write(searchLocalChunks(config, query, targetOpt.value, Number(limitOpt.value ?? "50")));
      return;
    }
    const toolArgs: Record<string, unknown> = {
      queries: [query],
      ...(limitOpt.value ? { limit: Number(limitOpt.value) } : {}),
      ...(targetOpt.value ? { source: `clip:${targetOpt.value}:` } : {}),
    };
    console.log(await callMcpTool(config, "ctx_search", toolArgs));
    return;
  }

  if (sub === "stats") {
    console.log(await callMcpTool(config, "ctx_stats", {}));
    return;
  }

  if (sub === "doctor") {
    console.log(await callMcpTool(config, "ctx_doctor", {}));
    return;
  }

  if (sub === "sources") {
    const target = parseOption(args.slice(1), "target").value;
    const rows = listSources(config, target);
    if (rows.length === 0) {
      console.log(target ? `No sources for ${target}.` : "No sources.");
      return;
    }
    for (const row of rows) {
      const chunks = "chunkCount" in row ? `\tchunks=${row.chunkCount}` : "";
      console.log(`${row.label}${chunks}`);
    }
    return;
  }

  if (sub === "purge") {
    const target = parseOption(args.slice(1), "target").value;
    if (!hasFlag(args, "yes") && !hasFlag(args, "force")) {
      fail("Refusing to purge without --yes.");
    }
    if (target) {
      const count = purgeTargetSources(config, target);
      console.log(`Purged ${count} source(s) for ${target}.`);
    } else {
      console.log(await callMcpTool(config, "ctx_purge", { confirm: true }));
    }
    return;
  }

  printCtxUsage();
}

type ListedSource = { label: string; chunkCount?: number };
type LocalSearchRow = {
  title: string;
  content: string;
  label: string;
  timestamp: string | null;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function searchLocalChunks(config: ExtensionConfig, query: string, target?: string, limit = 50): string {
  const dbPath = contextStorePath(config);
  if (!existsSync(dbPath)) return `No context-mode DB found: ${dbPath}\n`;

  const sourcePattern = `${target ? `clip:${target}:` : "clip:"}%`;
  const exact = `%${escapeLike(query)}%`;
  const cappedLimit = Math.max(1, Math.min(limit, 200));

  const db = new Database(dbPath);
  try {
    let rows = db
      .query(`
      SELECT chunks.title AS title, chunks.content AS content, sources.label AS label, chunks.timestamp AS timestamp
      FROM chunks
      JOIN sources ON sources.id = chunks.source_id
      WHERE sources.label LIKE ? ESCAPE '\\'
        AND (chunks.title LIKE ? ESCAPE '\\' OR chunks.content LIKE ? ESCAPE '\\')
      ORDER BY sources.id DESC, chunks.rowid ASC
      LIMIT ?
    `)
      .all(sourcePattern, exact, exact, cappedLimit) as LocalSearchRow[];

    if (rows.length === 0) {
      const terms = query
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean);
      if (terms.length > 1) {
        const clauses = terms
          .map(() => "(chunks.title LIKE ? ESCAPE '\\' OR chunks.content LIKE ? ESCAPE '\\')")
          .join(" AND ");
        const params = terms.flatMap((term) => {
          const pattern = `%${escapeLike(term)}%`;
          return [pattern, pattern];
        });
        rows = db
          .query(`
          SELECT chunks.title AS title, chunks.content AS content, sources.label AS label, chunks.timestamp AS timestamp
          FROM chunks
          JOIN sources ON sources.id = chunks.source_id
          WHERE sources.label LIKE ? ESCAPE '\\'
            AND ${clauses}
          ORDER BY sources.id DESC, chunks.rowid ASC
          LIMIT ?
        `)
          .all(sourcePattern, ...params, cappedLimit) as LocalSearchRow[];
      }
    }

    if (rows.length === 0) return `No local matches for '${query}'.\n`;

    const parts = [`## ${query}`, "", `local_matches: ${rows.length}${rows.length === cappedLimit ? "+" : ""}`, ""];
    for (const row of rows) {
      const ts = row.timestamp ? ` | ${row.timestamp.slice(0, 16).replace("T", " ")}` : "";
      parts.push(`--- [local${ts} | ${row.label}] ---`, `### ${row.title}`, "", row.content.trim(), "");
    }
    return `${parts.join("\n").trimEnd()}\n`;
  } finally {
    db.close();
  }
}

function listSources(config: ExtensionConfig, target?: string): ListedSource[] {
  const prefix = target ? `clip:${target}:` : "clip:";
  const dbPath = contextStorePath(config);
  if (existsSync(dbPath)) {
    try {
      const db = new Database(dbPath);
      try {
        return db
          .query("SELECT label, chunk_count AS chunkCount FROM sources WHERE label LIKE ? ORDER BY id DESC")
          .all(`${prefix}%`) as ListedSource[];
      } finally {
        db.close();
      }
    } catch {
      // Fall through to sidecar source records.
    }
  }
  return readSourceRecords()
    .filter((r) => r.label.startsWith(prefix))
    .map((r) => ({ label: r.label }));
}

function purgeTargetSources(config: ExtensionConfig, target: string): number {
  const pattern = `clip:${target}:%`;
  const dbPath = contextStorePath(config);
  let count = 0;

  if (existsSync(dbPath)) {
    const db = new Database(dbPath);
    try {
      const rows = db.query("SELECT id FROM sources WHERE label LIKE ?").all(pattern) as Array<{ id: number }>;
      count = rows.length;
      db.query("DELETE FROM chunks WHERE source_id IN (SELECT id FROM sources WHERE label LIKE ?)").run(pattern);
      db.query("DELETE FROM chunks_trigram WHERE source_id IN (SELECT id FROM sources WHERE label LIKE ?)").run(
        pattern,
      );
      db.query("DELETE FROM sources WHERE label LIKE ?").run(pattern);
      try {
        db.exec("INSERT INTO chunks(chunks) VALUES('optimize')");
      } catch {}
      try {
        db.exec("INSERT INTO chunks_trigram(chunks_trigram) VALUES('optimize')");
      } catch {}
    } finally {
      db.close();
    }
  }

  const remaining = readSourceRecords().filter((r) => !r.label.startsWith(`clip:${target}:`));
  writeFileSync(SOURCES_PATH, `${JSON.stringify(remaining, null, 2)}\n`, "utf8");
  return count;
}

function fail(message: string): never {
  process.stderr.write(`clip context-mode: ${message}\n`);
  process.exit(1);
}

export const extension: ClipExtension = {
  name: "clip-context-mode",
  init(api) {
    api.registerInternalCommand(
      "context",
      async ({ args }) => {
        await handleContextCommand(args);
      },
      {
        description: "enable or disable context-mode for clip targets",
      },
    );

    api.registerInternalCommand(
      "ctx",
      async ({ args }) => {
        await handleCtxCommand(args);
      },
      {
        description: "search and manage context-mode indexed output",
      },
    );

    api.registerHook("beforeExecute", async (ctx) => {
      if (process.env[BYPASS_ENV] === "1") return;

      const parsed = extractContextFlag(ctx.args);
      invocationOverride = parsed.override;
      invocationJsonChunkMode = parsed.jsonChunkMode;
      const config = readConfig();
      const policy = effectivePolicy(config, ctx.targetName, parsed.override, parsed.jsonChunkMode);

      if (ctx.passthrough && policy.enabled && policy.mode !== "off") {
        const result = await runClipBuffered(ctx, parsed.args);
        const compacted = await applyContextMode(ctx, result, parsed.args, parsed.override, parsed.jsonChunkMode);
        return { shortCircuit: compacted };
      }

      if (parsed.changed) return { args: parsed.args };
    });

    api.registerHook("afterExecute", async (ctx) => {
      if (process.env[BYPASS_ENV] === "1") return;
      if (!ctx.result) return;
      const compacted = await applyContextMode(ctx, ctx.result, ctx.args, invocationOverride, invocationJsonChunkMode);
      if (compacted === ctx.result) return;
      return { result: compacted };
    });
  },
};
