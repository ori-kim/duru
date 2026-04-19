import { readdirSync } from "fs";
import { homedir } from "os";
import { join, isAbsolute, resolve, dirname } from "path";
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

const aliasSchema = z.object({
  subcommand: z.string().min(1),
  args: z.array(z.string()).optional(),
  input: z.record(z.unknown()).optional(),
  description: z.string().optional(),
});

const aliasFields = {
  aliases: z.record(aliasSchema).optional(),
};

export const profileOverrideSchema = z.object({
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  command: z.string().optional(),
  url: z.string().url().optional(),
  endpoint: z.string().url().optional(),
  address: z.string().optional(),
  baseUrl: z.string().url().optional(),
  openapiUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
});

const profileFields = {
  profiles: z.record(profileOverrideSchema).optional(),
  active: z.string().optional(),
};

// HTTP MCP (기본값, 기존 설정 호환 — transport 미지정 시 "http"로 처리)
const mcpHttpTargetSchema = z.object({
  transport: z.literal("http").optional().default("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z.union([z.literal("oauth"), z.literal("apikey"), z.literal(false)]).optional().default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

// STDIO MCP (transport: "stdio" 명시 필수)
const mcpStdioTargetSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

// SSE MCP (transport: "sse" — legacy MCP SSE transport)
const mcpSseTargetSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z.union([z.literal("oauth"), z.literal("apikey"), z.literal(false)]).optional().default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

// stdio/sse를 먼저 체크하여 기존 설정(transport 없음)은 http로 폴백
const mcpTargetSchema = z.union([mcpStdioTargetSchema, mcpSseTargetSchema, mcpHttpTargetSchema]);

const cliTargetSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  acl: aclTreeSchema.optional(),
  ...profileFields,
  ...aliasFields,
});

const apiTargetSchema = z.object({
  openapiUrl: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  auth: z.union([z.literal("oauth"), z.literal("apikey"), z.literal(false)]).optional().default(false),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

const graphqlTargetSchema = z.object({
  endpoint: z.string().url(),
  introspect: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  oauth: z.boolean().optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

const grpcTargetSchema = z.object({
  address: z.string().min(1),
  plaintext: z.boolean().optional(),
  proto: z.string().min(1).optional(),
  importPaths: z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  reflectMetadata: z.record(z.string()).optional(),
  deadline: z.number().positive().optional(),
  emitDefaults: z.boolean().optional(),
  allowUnknownFields: z.boolean().optional(),
  oauth: z.boolean().optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

const RESERVED_SCRIPT_CMDS = ["tools", "describe", "types", "refresh", "login", "logout"];

const scriptCommandSchema = z.object({
  script: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  description: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
}).refine((d) => !!d.script !== !!d.file, {
  message: "exactly one of `script` or `file` must be set",
});

const scriptTargetSchema = z.object({
  description: z.string().optional(),
  commands: z.record(scriptCommandSchema)
    .refine(
      (m) => Object.keys(m).every((k) => !RESERVED_SCRIPT_CMDS.includes(k)),
      { message: `command names cannot be reserved: ${RESERVED_SCRIPT_CMDS.join(", ")}` },
    )
    .default({}),
  env: z.record(z.string()).optional(),
  ...aclFields,
  ...profileFields,
  ...aliasFields,
});

const TARGET_SCHEMAS = {
  cli: cliTargetSchema,
  mcp: mcpTargetSchema,
  api: apiTargetSchema,
  grpc: grpcTargetSchema,
  graphql: graphqlTargetSchema,
  script: scriptTargetSchema,
} as const;

// --- Types ---

export type ProfileOverride = z.infer<typeof profileOverrideSchema>;
export type AliasDef = z.infer<typeof aliasSchema>;
export type AclNode = z.infer<typeof aclNodeSchema>;
export type AclTree = z.infer<typeof aclTreeSchema>;
export type McpHttpTarget = z.infer<typeof mcpHttpTargetSchema>;
export type McpStdioTarget = z.infer<typeof mcpStdioTargetSchema>;
export type McpSseTarget = z.infer<typeof mcpSseTargetSchema>;
export type McpTarget = McpHttpTarget | McpStdioTarget | McpSseTarget;
export type CliTarget = z.infer<typeof cliTargetSchema>;
export type ApiTarget = z.infer<typeof apiTargetSchema>;
export type GrpcTarget = z.infer<typeof grpcTargetSchema>;
export type GraphqlTarget = z.infer<typeof graphqlTargetSchema>;
export type ScriptCommandDef = z.infer<typeof scriptCommandSchema>;
export type ScriptTarget = z.infer<typeof scriptTargetSchema>;
export type Config = {
  headers?: Record<string, string>;
  cli: Record<string, CliTarget>;
  mcp: Record<string, McpTarget>;
  api: Record<string, ApiTarget>;
  grpc: Record<string, GrpcTarget>;
  graphql: Record<string, GraphqlTarget>;
  script: Record<string, ScriptTarget>;
};

export type ResolvedTarget =
  | { type: "cli"; target: CliTarget }
  | { type: "mcp"; target: McpTarget }
  | { type: "api"; target: ApiTarget }
  | { type: "grpc"; target: GrpcTarget }
  | { type: "graphql"; target: GraphqlTarget }
  | { type: "script"; target: ScriptTarget };

// --- Paths ---

export const CONFIG_DIR = join(homedir(), ".clip");
export const TARGET_DIR = join(CONFIG_DIR, "target");

const TARGET_TYPES = ["cli", "mcp", "api", "grpc", "graphql", "script"] as const;
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

function resolveScriptPath(file: string, baseDir: string): string {
  if (file.startsWith("~/") || file === "~") {
    return join(homedir(), file.slice(1));
  }
  if (isAbsolute(file)) return file;
  return resolve(baseDir, file);
}

// --- Load ---

export async function loadConfig(): Promise<Config> {
  const globalEnv = await loadDotEnv(join(CONFIG_DIR, ".env"));
  const cli: Record<string, CliTarget> = {};
  const mcp: Record<string, McpTarget> = {};
  const api: Record<string, ApiTarget> = {};
  const grpc: Record<string, GrpcTarget> = {};
  const graphql: Record<string, GraphqlTarget> = {};
  const script: Record<string, ScriptTarget> = {};

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
      } else if (type === "api") {
        const t = result.data as ApiTarget;
        api[name] = { ...t, headers: subRecord(t.headers, env) };
      } else if (type === "grpc") {
        const t = result.data as GrpcTarget;
        grpc[name] = {
          ...t,
          metadata: subRecord(t.metadata, env),
          reflectMetadata: subRecord(t.reflectMetadata, env),
        };
      } else if (type === "graphql") {
        const t = result.data as GraphqlTarget;
        graphql[name] = { ...t, headers: subRecord(t.headers, env) };
      } else if (type === "script") {
        const t = result.data as ScriptTarget;
        const configDir = dirname(configPath);
        const resolvedCommands: ScriptTarget["commands"] = {};
        for (const [cmd, def] of Object.entries(t.commands)) {
          resolvedCommands[cmd] = def.file
            ? { ...def, file: resolveScriptPath(def.file, configDir) }
            : def;
        }
        script[name] = { ...t, commands: resolvedCommands };
      }
    }
  }

  return { cli, mcp, api, grpc, graphql, script };
}

// --- Management helpers ---

export async function addTarget(name: string, type: "cli", target: CliTarget): Promise<void>;
export async function addTarget(name: string, type: "mcp", target: McpTarget): Promise<void>;
export async function addTarget(name: string, type: "api", target: ApiTarget): Promise<void>;
export async function addTarget(name: string, type: "grpc", target: GrpcTarget): Promise<void>;
export async function addTarget(name: string, type: "graphql", target: GraphqlTarget): Promise<void>;
export async function addTarget(name: string, type: "script", target: ScriptTarget): Promise<void>;
export async function addTarget(
  name: string,
  type: TargetType,
  target: CliTarget | McpTarget | ApiTarget | GrpcTarget | GraphqlTarget | ScriptTarget,
): Promise<void> {
  const config = await loadConfig();
  const allNames = new Set([
    ...Object.keys(config.cli), ...Object.keys(config.mcp),
    ...Object.keys(config.api), ...Object.keys(config.grpc),
    ...Object.keys(config.graphql), ...Object.keys(config.script),
  ]);
  if (allNames.has(name) && !config[type]?.[name]) {
    die(`Target name "${name}" is already used by another type. Choose a different name.`);
  }

  const dir = join(TARGET_DIR, type, name);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(join(dir, "config.yml"), YAML.stringify(target));
}

export async function updateTarget(
  name: string,
  updater: (raw: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  for (const type of TARGET_TYPES) {
    const configPath = join(TARGET_DIR, type, name, "config.yml");
    const file = Bun.file(configPath);
    if (!(await file.exists())) continue;
    const raw = YAML.parse(await file.text()) as Record<string, unknown>;
    await Bun.write(configPath, YAML.stringify(updater(raw)));
    return;
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
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
  if (config.grpc[name]) return { type: "grpc", target: config.grpc[name]! };
  if (config.graphql[name]) return { type: "graphql", target: config.graphql[name]! };
  if (config.script[name]) return { type: "script", target: config.script[name]! };
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function mergeHeaders(
  global: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(global ?? {}), ...(local ?? {}) };
}
