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
  oauth: z.boolean().optional(), // undefined=자동감지, true=강제, false=비활성
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

const configSchema = z.object({
  headers: z.record(z.string()).optional(),
  cli: z.record(cliTargetSchema).default({}),
  mcp: z.record(mcpTargetSchema).default({}),
});

// --- Types ---

export type AclNode = z.infer<typeof aclNodeSchema>;
export type AclTree = z.infer<typeof aclTreeSchema>;
export type McpHttpTarget = z.infer<typeof mcpHttpTargetSchema>;
export type McpStdioTarget = z.infer<typeof mcpStdioTargetSchema>;
export type McpTarget = McpHttpTarget | McpStdioTarget;
export type CliTarget = z.infer<typeof cliTargetSchema>;
export type Config = z.infer<typeof configSchema>;

export type ResolvedTarget =
  | { type: "cli"; target: CliTarget }
  | { type: "mcp"; target: McpTarget };

// --- Paths ---

const CONFIG_DIR = join(homedir(), ".clip");
const CONFIG_YML = join(CONFIG_DIR, "settings.yml");
const CONFIG_JSON = join(CONFIG_DIR, "settings.json");

export { CONFIG_DIR };

/** 실제 사용 중인 설정 파일 경로를 반환. yml 우선, json fallback. */
async function resolveConfigPath(): Promise<{ path: string; format: "yml" | "json" } | null> {
  if (await Bun.file(CONFIG_YML).exists()) return { path: CONFIG_YML, format: "yml" };
  if (await Bun.file(CONFIG_JSON).exists()) return { path: CONFIG_JSON, format: "json" };
  return null;
}

/** 외부에서 현재 설정 파일 경로를 표시할 때 사용 */
export async function getConfigPath(): Promise<string> {
  const resolved = await resolveConfigPath();
  return resolved?.path ?? CONFIG_YML;
}

// --- Load / Save ---

export async function loadConfig(): Promise<Config> {
  const resolved = await resolveConfigPath();
  if (!resolved) return configSchema.parse({ cli: {}, mcp: {} });

  const raw = await Bun.file(resolved.path).text();
  let parsed: unknown;
  try {
    parsed = resolved.format === "json" ? JSON.parse(raw) : YAML.parse(raw);
  } catch (e) {
    die(`Failed to parse config at ${resolved.path}: ${e}`);
  }

  const result = configSchema.safeParse(parsed ?? { cli: {}, mcp: {} });
  if (!result.success) {
    die(`Invalid config at ${resolved.path}:\n${result.error.message}`);
  }
  const globalEnv = await loadDotEnv(join(CONFIG_DIR, ".env"));
  const config = result.data;
  return {
    ...config,
    headers: subRecord(config.headers, globalEnv),
    mcp: Object.fromEntries(
      await Promise.all(
        Object.entries(config.mcp).map(async ([name, t]) => {
          if (t.transport === "stdio") return [name, t];
          const targetEnv = await loadDotEnv(join(CONFIG_DIR, name, ".env"));
          const env = { ...globalEnv, ...targetEnv };
          return [name, { ...t, headers: subRecord(t.headers, env) }];
        }),
      ),
    ),
  };
}

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


function subRecord(r: Record<string, string> | undefined, env: Record<string, string>): Record<string, string> | undefined {
  if (!r) return r;
  const merged = { ...process.env, ...env } as Record<string, string>;
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, v.replace(/\$\{([^}]+)\}/g, (_, key) => merged[key] ?? "")])
  );
}

/** 기존 파일 포맷 유지. 파일이 없으면 yml로 생성. */
async function saveConfig(config: Config): Promise<void> {
  await Bun.spawn(["mkdir", "-p", CONFIG_DIR]).exited;
  const resolved = await resolveConfigPath();
  const format = resolved?.format ?? "yml";
  const path = resolved?.path ?? CONFIG_YML;

  const content = format === "json" ? JSON.stringify(config, null, 2) : YAML.stringify(config);
  await Bun.write(path, content);
}

// --- Management helpers ---

export async function addTarget(name: string, type: "cli", target: CliTarget): Promise<void>;
export async function addTarget(name: string, type: "mcp", target: McpTarget): Promise<void>;
export async function addTarget(name: string, type: "cli" | "mcp", target: CliTarget | McpTarget): Promise<void> {
  const config = await loadConfig();
  if (type === "cli") {
    config.cli[name] = target as CliTarget;
  } else {
    config.mcp[name] = target as McpTarget;
  }
  await saveConfig(config);
}

export async function removeTarget(name: string): Promise<void> {
  const config = await loadConfig();
  if (config.cli[name]) {
    delete config.cli[name];
  } else if (config.mcp[name]) {
    delete config.mcp[name];
  } else {
    die(`Target "${name}" not found.`);
  }
  await saveConfig(config);
}

export function getTarget(config: Config, name: string): ResolvedTarget {
  if (config.cli[name]) return { type: "cli", target: config.cli[name]! };
  if (config.mcp[name]) return { type: "mcp", target: config.mcp[name]! };
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function mergeHeaders(
  global: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(global ?? {}), ...(local ?? {}) };
}
