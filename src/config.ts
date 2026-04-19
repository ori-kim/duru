import { readdirSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";
import YAML from "yaml";
import { type ApiTarget, apiTargetSchema } from "./builtin/api/schema.ts";
import { type CliTarget, cliTargetSchema } from "./builtin/cli/schema.ts";
import { type GraphqlTarget, graphqlTargetSchema } from "./builtin/graphql/schema.ts";
import { type GrpcTarget, grpcTargetSchema } from "./builtin/grpc/schema.ts";
import {
  type McpHttpTarget,
  type McpSseTarget,
  type McpStdioTarget,
  type McpTarget,
  mcpTargetSchema,
} from "./builtin/mcp/schema.ts";
import { type ScriptCommandDef, type ScriptTarget, scriptTargetSchema } from "./builtin/script/schema.ts";
import type { TargetResult } from "./extension.ts";
import { die } from "./utils/errors.ts";
import {
  type AclNode,
  type AclTree,
  type AliasDef,
  type ProfileOverride,
  profileOverrideSchema,
} from "./utils/target-schema.ts";

// Re-export for backward compatibility
export { profileOverrideSchema };
export type {
  ProfileOverride,
  AliasDef,
  AclNode,
  AclTree,
  McpHttpTarget,
  McpStdioTarget,
  McpSseTarget,
  McpTarget,
  CliTarget,
  ApiTarget,
  GrpcTarget,
  GraphqlTarget,
  ScriptCommandDef,
  ScriptTarget,
  TargetResult,
};

export const TARGET_TYPES = ["cli", "mcp", "api", "grpc", "graphql", "script"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const TARGET_SCHEMAS = {
  cli: cliTargetSchema,
  mcp: mcpTargetSchema,
  api: apiTargetSchema,
  grpc: grpcTargetSchema,
  graphql: graphqlTargetSchema,
  script: scriptTargetSchema,
} as const;

// --- Types ---

export type Config = {
  headers?: Record<string, string>;
  cli: Record<string, CliTarget>;
  mcp: Record<string, McpTarget>;
  api: Record<string, ApiTarget>;
  grpc: Record<string, GrpcTarget>;
  graphql: Record<string, GraphqlTarget>;
  script: Record<string, ScriptTarget>;
  _ext: Record<string, Record<string, unknown>>; // extension 타겟: type -> name -> raw config
};

export type ResolvedTarget =
  | { type: "cli"; target: CliTarget }
  | { type: "mcp"; target: McpTarget }
  | { type: "api"; target: ApiTarget }
  | { type: "grpc"; target: GrpcTarget }
  | { type: "graphql"; target: GraphqlTarget }
  | { type: "script"; target: ScriptTarget }
  | { type: string; target: unknown }; // extension 타겟

// --- Paths ---

export const CONFIG_DIR = join(homedir(), ".clip");
export const TARGET_DIR = join(CONFIG_DIR, "target");

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
  const _ext: Record<string, Record<string, unknown>> = {};

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
          resolvedCommands[cmd] = def.file ? { ...def, file: resolveScriptPath(def.file, configDir) } : def;
        }
        script[name] = { ...t, commands: resolvedCommands };
      }
    }
  }

  // extension 타겟 타입: TARGET_DIR 아래 빌트인 외 타입 폴더의 raw config를 저장
  const builtinSet = new Set<string>(TARGET_TYPES);
  let extTypeDirs: string[];
  try {
    extTypeDirs = readdirSync(TARGET_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !builtinSet.has(d.name))
      .map((d) => d.name);
  } catch {
    extTypeDirs = [];
  }

  for (const extType of extTypeDirs) {
    const typeDir = join(TARGET_DIR, extType);
    let names: string[];
    try {
      names = readdirSync(typeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    _ext[extType] = {};
    for (const name of names) {
      const configPath = join(typeDir, name, "config.yml");
      const file = Bun.file(configPath);
      if (!(await file.exists())) continue;
      try {
        _ext[extType]![name] = YAML.parse(await file.text()) as unknown;
      } catch {
        /* 파싱 실패 시 skip */
      }
    }
  }

  return { cli, mcp, api, grpc, graphql, script, _ext };
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
    ...Object.keys(config.cli),
    ...Object.keys(config.mcp),
    ...Object.keys(config.api),
    ...Object.keys(config.grpc),
    ...Object.keys(config.graphql),
    ...Object.keys(config.script),
    ...Object.values(config._ext ?? {}).flatMap((targets) => Object.keys(targets)),
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
  const builtinSet = new Set<string>(TARGET_TYPES);
  let extTypeDirs: string[];
  try {
    extTypeDirs = readdirSync(TARGET_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !builtinSet.has(d.name))
      .map((d) => d.name);
  } catch {
    extTypeDirs = [];
  }
  for (const extType of extTypeDirs) {
    const dir = join(TARGET_DIR, extType, name);
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
  for (const [extType, targets] of Object.entries(config._ext ?? {})) {
    if (targets[name] !== undefined) return { type: extType, target: targets[name]! };
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function mergeHeaders(
  global: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(global ?? {}), ...(local ?? {}) };
}
