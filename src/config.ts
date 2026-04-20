import { existsSync, readFileSync, readdirSync } from "fs";
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
  _sources?: Record<string, string | null>; // name -> workspace name (null = global)
  _configDirs?: Record<string, string>; // name -> absolute configDir path
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
export const WORKSPACE_ROOT = join(CONFIG_DIR, "workspace");
export const WORKSPACE_FILE = join(CONFIG_DIR, ".workspace");
export const RESERVED_WORKSPACE_NAMES = new Set(["target", "bin", "extensions", "hooks"]);

// --- Workspace helpers ---

export function getActiveWorkspace(): string | null {
  try {
    const content = readFileSync(WORKSPACE_FILE, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

export function getWorkspaceDir(name: string): string {
  return join(WORKSPACE_ROOT, name);
}

export function listWorkspaces(): string[] {
  try {
    return readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// Returns target dirs in load-order: global first (lower priority), workspace last (overrides).
export function getTargetDirs(): { dir: string; workspace: string | null }[] {
  const ws = getActiveWorkspace();
  const dirs: { dir: string; workspace: string | null }[] = [
    { dir: join(CONFIG_DIR, "target"), workspace: null },
  ];
  if (ws) dirs.push({ dir: join(WORKSPACE_ROOT, ws, "target"), workspace: ws });
  return dirs;
}

// Find the directory where a specific named target's config.yml lives (workspace-first).
export function findTargetConfigDir(name: string, type: string): string | null {
  const dirs = [...getTargetDirs()].reverse(); // workspace first for lookup
  for (const { dir } of dirs) {
    const targetDir = join(dir, type, name);
    if (existsSync(join(targetDir, "config.yml"))) return targetDir;
  }
  return null;
}

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

function subProfiles<P extends { headers?: Record<string, string>; metadata?: Record<string, string> }>(
  profiles: Record<string, P> | undefined,
  env: Record<string, string>,
  fields: ReadonlyArray<"headers" | "metadata">,
): Record<string, P> | undefined {
  if (!profiles) return profiles;
  return Object.fromEntries(
    Object.entries(profiles).map(([name, p]) => {
      const next = { ...p };
      for (const f of fields) {
        const r = next[f];
        if (r) (next as Record<string, unknown>)[f] = subRecord(r, env);
      }
      return [name, next];
    }),
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
  const ws = getActiveWorkspace();
  const wsEnv = ws ? await loadDotEnv(join(getWorkspaceDir(ws), ".env")) : {};
  const baseEnv = { ...globalEnv, ...wsEnv };

  const cli: Record<string, CliTarget> = {};
  const mcp: Record<string, McpTarget> = {};
  const api: Record<string, ApiTarget> = {};
  const grpc: Record<string, GrpcTarget> = {};
  const graphql: Record<string, GraphqlTarget> = {};
  const script: Record<string, ScriptTarget> = {};
  const _ext: Record<string, Record<string, unknown>> = {};
  const _sources: Record<string, string | null> = {};
  const _configDirs: Record<string, string> = {};

  // Process each target dir: global first, workspace last (workspace overrides global on same name).
  for (const { dir: targetDirBase, workspace: srcWorkspace } of getTargetDirs()) {
    for (const type of TARGET_TYPES) {
      const typeDir = join(targetDirBase, type);
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
        const base = srcWorkspace ? baseEnv : globalEnv;
        const env = { ...base, ...targetEnv };

        _sources[name] = srcWorkspace;
        _configDirs[name] = join(typeDir, name);

        if (type === "cli") {
          cli[name] = result.data as CliTarget;
        } else if (type === "mcp") {
          const t = result.data as McpTarget;
          mcp[name] =
            t.transport === "stdio"
              ? t
              : { ...t, headers: subRecord(t.headers, env), profiles: subProfiles(t.profiles, env, ["headers"]) };
        } else if (type === "api") {
          const t = result.data as ApiTarget;
          api[name] = { ...t, headers: subRecord(t.headers, env), profiles: subProfiles(t.profiles, env, ["headers"]) };
        } else if (type === "grpc") {
          const t = result.data as GrpcTarget;
          grpc[name] = {
            ...t,
            metadata: subRecord(t.metadata, env),
            reflectMetadata: subRecord(t.reflectMetadata, env),
            profiles: subProfiles(t.profiles, env, ["metadata"]),
          };
        } else if (type === "graphql") {
          const t = result.data as GraphqlTarget;
          graphql[name] = {
            ...t,
            headers: subRecord(t.headers, env),
            profiles: subProfiles(t.profiles, env, ["headers"]),
          };
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

    // Extension target types for this dir
    const builtinSet = new Set<string>(TARGET_TYPES);
    let extTypeDirs: string[];
    try {
      extTypeDirs = readdirSync(targetDirBase, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !builtinSet.has(d.name))
        .map((d) => d.name);
    } catch {
      extTypeDirs = [];
    }

    for (const extType of extTypeDirs) {
      const typeDir = join(targetDirBase, extType);
      let names: string[];
      try {
        names = readdirSync(typeDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }
      if (!_ext[extType]) _ext[extType] = {};
      for (const name of names) {
        const configPath = join(typeDir, name, "config.yml");
        const file = Bun.file(configPath);
        if (!(await file.exists())) continue;
        try {
          _ext[extType]![name] = YAML.parse(await file.text()) as unknown;
          _sources[name] = srcWorkspace;
        } catch (e) {
          process.stderr.write(`clip: warning: failed to parse ${configPath}: ${e}\n`);
        }
      }
    }
  }

  return { cli, mcp, api, grpc, graphql, script, _ext, _sources, _configDirs };
}

// --- Management helpers ---

export async function addTarget(name: string, type: "cli", target: CliTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(name: string, type: "mcp", target: McpTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(name: string, type: "api", target: ApiTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(name: string, type: "grpc", target: GrpcTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(name: string, type: "graphql", target: GraphqlTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(name: string, type: "script", target: ScriptTarget, opts?: { global?: boolean; workspace?: string }): Promise<void>;
export async function addTarget(
  name: string,
  type: TargetType,
  target: CliTarget | McpTarget | ApiTarget | GrpcTarget | GraphqlTarget | ScriptTarget,
  opts?: { global?: boolean; workspace?: string },
): Promise<void> {
  const ws = opts?.global ? null : (opts?.workspace ?? getActiveWorkspace());
  if (ws && !existsSync(getWorkspaceDir(ws))) die(`Workspace "${ws}" does not exist.`);
  const targetDirBase = ws ? join(getWorkspaceDir(ws), "target") : join(CONFIG_DIR, "target");

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

  const dir = join(targetDirBase, type, name);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(join(dir, "config.yml"), YAML.stringify(target));
}

export async function updateTarget(
  name: string,
  updater: (raw: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const dirs = [...getTargetDirs()].reverse(); // workspace first
  for (const { dir: targetDirBase } of dirs) {
    for (const type of TARGET_TYPES) {
      const configPath = join(targetDirBase, type, name, "config.yml");
      const file = Bun.file(configPath);
      if (!(await file.exists())) continue;
      const raw = YAML.parse(await file.text()) as Record<string, unknown>;
      await Bun.write(configPath, YAML.stringify(updater(raw)));
      return;
    }
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

function hasGlobalTarget(name: string): boolean {
  if (TARGET_TYPES.some((t) => existsSync(join(CONFIG_DIR, "target", t, name, "config.yml")))) return true;
  try {
    const builtinSet = new Set<string>(TARGET_TYPES);
    return readdirSync(join(CONFIG_DIR, "target"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !builtinSet.has(d.name))
      .some((d) => existsSync(join(CONFIG_DIR, "target", d.name, name, "config.yml")));
  } catch {
    return false;
  }
}

export async function removeTarget(name: string): Promise<void> {
  const dirs = [...getTargetDirs()].reverse(); // workspace first
  const builtinSet = new Set<string>(TARGET_TYPES);

  for (const { dir: targetDirBase, workspace } of dirs) {
    for (const type of TARGET_TYPES) {
      const dir = join(targetDirBase, type, name);
      if (await Bun.file(join(dir, "config.yml")).exists()) {
        await Bun.spawn(["rm", "-rf", dir]).exited;
        if (workspace !== null && hasGlobalTarget(name)) {
          console.warn(`warning: removed workspace copy of "${name}"; the global target is now active.`);
        }
        return;
      }
    }
    let extTypeDirs: string[];
    try {
      extTypeDirs = readdirSync(targetDirBase, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !builtinSet.has(d.name))
        .map((d) => d.name);
    } catch {
      extTypeDirs = [];
    }
    for (const extType of extTypeDirs) {
      const dir = join(targetDirBase, extType, name);
      if (await Bun.file(join(dir, "config.yml")).exists()) {
        await Bun.spawn(["rm", "-rf", dir]).exited;
        if (workspace !== null && hasGlobalTarget(name)) {
          console.warn(`warning: removed workspace copy of "${name}"; the global target is now active.`);
        }
        return;
      }
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
