import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import YAML from "yaml";
import { type ApiTarget } from "./builtin/api/schema.ts";
import { type CliTarget } from "./builtin/cli/schema.ts";
import { type GraphqlTarget } from "./builtin/graphql/schema.ts";
import { type GrpcTarget } from "./builtin/grpc/schema.ts";
import {
  type McpHttpTarget,
  type McpSseTarget,
  type McpStdioTarget,
  type McpTarget,
} from "./builtin/mcp/schema.ts";
import { type ScriptCommandDef, type ScriptTarget } from "./builtin/script/schema.ts";
import { createDefaultRegistry } from "./builtin-loader.ts";
import type { NormalizeCtx, TargetResult, TargetTypeDef } from "./extension.ts";
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

// --- Types ---

export type Config = {
  headers?: Record<string, string>;
  targets: Record<string, Record<string, unknown>>; // type -> name -> normalized config
  _ext: Record<string, Record<string, unknown>>; // extension 타겟: type -> name -> raw config
  _sources?: Record<string, string | null>; // name -> workspace name (null = global)
  _configDirs?: Record<string, string>; // name -> absolute configDir path
};

export type ResolvedTarget = { type: string; target: unknown };

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

// --- Load ---

// Lazy registry for normalizeConfig — initialized once per process.
let _configRegistry: { getTargetType: (t: string) => TargetTypeDef | undefined } | undefined;

async function getConfigRegistry(): Promise<{ getTargetType: (t: string) => TargetTypeDef | undefined }> {
  if (!_configRegistry) {
    const reg = createDefaultRegistry();
    await reg.initAll();
    _configRegistry = reg;
  }
  return _configRegistry;
}

export async function loadConfig(): Promise<Config> {
  const globalEnv = await loadDotEnv(join(CONFIG_DIR, ".env"));
  const ws = getActiveWorkspace();
  const wsEnv = ws ? await loadDotEnv(join(getWorkspaceDir(ws), ".env")) : {};
  const baseEnv = { ...globalEnv, ...wsEnv };

  const reg = await getConfigRegistry();

  const targets: Record<string, Record<string, unknown>> = {};
  const _ext: Record<string, Record<string, unknown>> = {};
  const _sources: Record<string, string | null> = {};
  const _configDirs: Record<string, string> = {};

  // Process each target dir: global first, workspace last (workspace overrides global on same name).
  for (const { dir: targetDirBase, workspace: srcWorkspace } of getTargetDirs()) {
    // Enumerate all type subdirectories under this target dir.
    let allTypeDirs: string[];
    try {
      allTypeDirs = readdirSync(targetDirBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      allTypeDirs = [];
    }

    for (const type of allTypeDirs) {
      const typeDir = join(targetDirBase, type);
      let names: string[];
      try {
        names = readdirSync(typeDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }

      // Registry에 등록된 타입이면 builtin/extension 공통 normalizeConfig 경로,
      // 등록되지 않은 타입이면 raw 저장 (dispatch 시 lazy schema 검증).
      const def = reg.getTargetType(type);

      for (const name of names) {
        const configDir = join(typeDir, name);
        const configPath = join(configDir, "config.yml");
        const file = Bun.file(configPath);
        if (!(await file.exists())) continue;

        let rawParsed: unknown;
        try {
          rawParsed = YAML.parse(await file.text());
        } catch (e) {
          die(`Failed to parse config at ${configPath}: ${e}`);
        }

        _sources[name] = srcWorkspace;
        _configDirs[name] = configDir;

        if (!def) {
          // Unregistered type: store raw config, schema validation deferred to dispatch.
          if (!_ext[type]) _ext[type] = {};
          _ext[type]![name] = rawParsed as unknown;
          continue;
        }

        // Registered type: validate schema then call normalizeConfig.
        const result = def.schema.safeParse(rawParsed);
        if (!result.success) {
          die(`Invalid config at ${configPath}:\n${result.error.message}`);
        }

        const targetEnv = await loadDotEnv(join(configDir, ".env"));
        const base = srcWorkspace ? baseEnv : globalEnv;
        const env = { ...base, ...targetEnv };

        const normalizeCtx: NormalizeCtx = { configDir, env };
        const normalized = def.normalizeConfig
          ? def.normalizeConfig(result.data as never, normalizeCtx)
          : result.data;

        if (!targets[type]) targets[type] = {};
        targets[type]![name] = normalized as unknown;
      }
    }
  }

  return { targets, _ext, _sources, _configDirs };
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
  const allNames = getAllTargetNames(config);
  if (allNames.has(name) && !(config.targets[type]?.[name])) {
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
    // Enumerate all type subdirectories to find the target.
    let typeDirs: string[];
    try {
      typeDirs = readdirSync(targetDirBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      typeDirs = [];
    }
    for (const type of typeDirs) {
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
  try {
    const globalTargetDir = join(CONFIG_DIR, "target");
    const typeDirs = readdirSync(globalTargetDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    return typeDirs.some((t) => existsSync(join(globalTargetDir, t, name, "config.yml")));
  } catch {
    return false;
  }
}

export async function removeTarget(name: string): Promise<void> {
  const dirs = [...getTargetDirs()].reverse(); // workspace first

  for (const { dir: targetDirBase, workspace } of dirs) {
    let typeDirs: string[];
    try {
      typeDirs = readdirSync(targetDirBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      typeDirs = [];
    }
    for (const type of typeDirs) {
      const dir = join(targetDirBase, type, name);
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

// getAllTargetNames returns the set of all registered target names across builtin and extension types.
export function getAllTargetNames(config: Config): Set<string> {
  return new Set([
    ...Object.values(config.targets).flatMap((byName) => Object.keys(byName)),
    ...Object.values(config._ext ?? {}).flatMap((byName) => Object.keys(byName)),
  ]);
}

export function getTarget(config: Config, name: string): ResolvedTarget {
  for (const [type, byName] of Object.entries(config.targets)) {
    if (byName[name] !== undefined) return { type, target: byName[name]! };
  }
  for (const [extType, byName] of Object.entries(config._ext ?? {})) {
    if (byName[name] !== undefined) return { type: extType, target: byName[name]! };
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

export function mergeHeaders(
  global: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): Record<string, string> {
  return { ...(global ?? {}), ...(local ?? {}) };
}
