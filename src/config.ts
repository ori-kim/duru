import { readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import YAML from "yaml";
import { z } from "zod";
import { die } from "./errors.ts";

// --- Schemas ---

const aclNodeSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const aclTreeSchema = z.record(aclNodeSchema);

const aclFields = {
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  acl: aclTreeSchema.optional(),
};

// HTTP MCP (기본값, 기존 설정 호환 — transport 미지정 시 "http"로 처리)
const mcpHttpTargetSchema = z.object({
  transport: z.literal("http").optional().default("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z.union([z.literal("oauth"), z.literal("apikey"), z.literal(false)]).optional().default(false),
  ...aclFields,
});

// STDIO MCP (transport: "stdio" 명시 필수)
const mcpStdioTargetSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  ...aclFields,
});

// stdio를 먼저 체크하여 기존 설정(transport 없음)은 http로 폴백
const mcpTargetSchema = z.union([mcpStdioTargetSchema, mcpHttpTargetSchema]);

const cliTargetSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  acl: aclTreeSchema.optional(),
});

const apiTargetSchema = z.object({
  openapiUrl: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  auth: z.union([z.literal("oauth"), z.literal("apikey"), z.literal(false)]).optional().default(false),
  ...aclFields,
});

const TARGET_SCHEMAS = {
  cli: cliTargetSchema,
  mcp: mcpTargetSchema,
  api: apiTargetSchema,
} as const;

// --- Types ---

export type AclNode = z.infer<typeof aclNodeSchema>;
export type AclTree = z.infer<typeof aclTreeSchema>;
export type McpHttpTarget = z.infer<typeof mcpHttpTargetSchema>;
export type McpStdioTarget = z.infer<typeof mcpStdioTargetSchema>;
export type McpTarget = McpHttpTarget | McpStdioTarget;
export type CliTarget = z.infer<typeof cliTargetSchema>;
export type ApiTarget = z.infer<typeof apiTargetSchema>;
export type Config = {
  headers?: Record<string, string>;
  cli: Record<string, CliTarget>;
  mcp: Record<string, McpTarget>;
  api: Record<string, ApiTarget>;
};

export type ResolvedTarget =
  | { type: "cli"; target: CliTarget }
  | { type: "mcp"; target: McpTarget }
  | { type: "api"; target: ApiTarget };

// --- Paths ---

export const CONFIG_DIR = join(homedir(), ".clip");
export const TARGET_DIR = join(CONFIG_DIR, "target");

const TARGET_TYPES = ["cli", "mcp", "api"] as const;
type TargetType = typeof TARGET_TYPES[number];

// --- Helpers ---

async function loadDotEnv(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const env: Record<string, string> = {};
  for (const line of (await file.text()).split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

function subRecord(
  r: Record<string, string> | undefined,
  env: Record<string, string>,
): Record<string, string> | undefined {
  if (!r) return r;
  const merged = { ...process.env, ...env } as Record<string, string>;
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, v.replace(/\$\{([^}]+)\}/g, (_, key) => merged[key] ?? "")]),
  );
}

// --- Load ---

export async function loadConfig(): Promise<Config> {
  const globalEnv = await loadDotEnv(join(CONFIG_DIR, ".env"));
  const cli: Record<string, CliTarget> = {};
  const mcp: Record<string, McpTarget> = {};
  const api: Record<string, ApiTarget> = {};

  for (const type of TARGET_TYPES) {
    const typeDir = join(TARGET_DIR, type);
    let names: string[];
    try {
      names = readdirSync(typeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const name of names) {
      const configPath = join(typeDir, name, "config.yml");
      const file = Bun.file(configPath);
      if (!(await file.exists())) continue;

      let parsed: unknown;
      try {
        parsed = YAML.parse(await file.text());
      } catch (e) {
        die(`Failed to parse config at ${configPath}: ${e}`);
      }

      const result = TARGET_SCHEMAS[type].safeParse(parsed);
      if (!result.success) {
        die(`Invalid config at ${configPath}:\n${result.error.message}`);
      }

      const targetEnv = await loadDotEnv(join(typeDir, name, ".env"));
      const env = { ...globalEnv, ...targetEnv };

      if (type === "cli") {
        cli[name] = result.data as CliTarget;
      } else if (type === "mcp") {
        const t = result.data as McpTarget;
        mcp[name] = t.transport === "stdio" ? t : { ...t, headers: subRecord(t.headers, env) };
      } else {
        const t = result.data as ApiTarget;
        api[name] = { ...t, headers: subRecord(t.headers, env) };
      }
    }
  }

  return { cli, mcp, api };
}

// --- Management helpers ---

export async function addTarget(name: string, type: "cli", target: CliTarget): Promise<void>;
export async function addTarget(name: string, type: "mcp", target: McpTarget): Promise<void>;
export async function addTarget(name: string, type: "api", target: ApiTarget): Promise<void>;
export async function addTarget(
  name: string,
  type: TargetType,
  target: CliTarget | McpTarget | ApiTarget,
): Promise<void> {
  const config = await loadConfig();
  const allNames = new Set([...Object.keys(config.cli), ...Object.keys(config.mcp), ...Object.keys(config.api)]);
  if (allNames.has(name) && !config[type]?.[name]) {
    die(`Target name "${name}" is already used by another type. Choose a different name.`);
  }

  const dir = join(TARGET_DIR, type, name);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(join(dir, "config.yml"), YAML.stringify(target));
}

export async function removeTarget(name: string): Promise<void> {
  for (const type of TARGET_TYPES) {
    const dir = join(TARGET_DIR, type, name);
    if (await Bun.file(join(dir, "config.yml")).exists()) {
      await Bun.spawn(["rm", "-rf", dir]).exited;
      return;
    }
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function getTarget(config: Config, name: string): ResolvedTarget {
  if (config.cli[name]) return { type: "cli", target: config.cli[name]! };
  if (config.mcp[name]) return { type: "mcp", target: config.mcp[name]! };
  if (config.api[name]) return { type: "api", target: config.api[name]! };
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function mergeHeaders(
  global: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(global ?? {}), ...(local ?? {}) };
}
