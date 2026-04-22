import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import YAML from "yaml";
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
  TargetResult,
};

// --- Types ---

export type Config = {
  headers?: Record<string, string>;
  targets: Record<string, Record<string, unknown>>; // type -> name -> normalized config
  _ext: Record<string, Record<string, unknown>>; // extension 타겟: type -> name -> raw config
  _configDirs?: Record<string, string>; // name -> absolute configDir path
};

export type ResolvedTarget = { type: string; target: unknown };

// --- Paths ---

export const CONFIG_DIR = process.env.CLIP_HOME ?? join(homedir(), ".clip");
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

// --- Load ---

/**
 * loadConfig — config.yml들을 읽어 Config 객체를 반환한다.
 *
 * registry를 인자로 받으면 normalizeConfig를 수행하고, 없으면 raw 저장 후 dispatch 시 lazy 검증.
 * 인자 없이 호출하면 builtin-loader를 import하지 않으므로 순환 의존이 없다.
 */
export async function loadConfig(
  registry?: { getTargetType: (t: string) => TargetTypeDef | undefined },
): Promise<Config> {
  const globalEnv = await loadDotEnv(join(CONFIG_DIR, ".env"));
  const reg = registry ?? { getTargetType: () => undefined };

  const targets: Record<string, Record<string, unknown>> = {};
  const _ext: Record<string, Record<string, unknown>> = {};
  const _configDirs: Record<string, string> = {};

  let allTypeDirs: string[];
  try {
    allTypeDirs = readdirSync(TARGET_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    allTypeDirs = [];
  }

  for (const type of allTypeDirs) {
    const typeDir = join(TARGET_DIR, type);
    let names: string[];
    try {
      names = readdirSync(typeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

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

      _configDirs[name] = configDir;

      if (!def) {
        if (!_ext[type]) _ext[type] = {};
        _ext[type]![name] = rawParsed as unknown;
        continue;
      }

      const result = def.schema.safeParse(rawParsed);
      if (!result.success) {
        die(`Invalid config at ${configPath}:\n${result.error.message}`);
      }

      const targetEnv = await loadDotEnv(join(configDir, ".env"));
      const env = { ...globalEnv, ...targetEnv };

      const normalizeCtx: NormalizeCtx = { configDir, env };
      const normalized = def.normalizeConfig
        ? def.normalizeConfig(result.data as never, normalizeCtx)
        : result.data;

      if (!targets[type]) targets[type] = {};
      targets[type]![name] = normalized as unknown;
    }
  }

  return { targets, _ext, _configDirs };
}

// --- Find ---

export function findTargetConfigDir(name: string, type: string): string | null {
  const targetDir = join(TARGET_DIR, type, name);
  if (existsSync(join(targetDir, "config.yml"))) return targetDir;
  return null;
}

// --- Management helpers ---

export async function addTarget(
  name: string,
  type: string,
  target: Record<string, unknown>,
): Promise<void> {
  const config = await loadConfig();
  const allNames = getAllTargetNames(config);
  if (allNames.has(name) && !(config.targets[type]?.[name])) {
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
  let typeDirs: string[];
  try {
    typeDirs = readdirSync(TARGET_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    typeDirs = [];
  }
  for (const type of typeDirs) {
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
  let typeDirs: string[];
  try {
    typeDirs = readdirSync(TARGET_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    typeDirs = [];
  }
  for (const type of typeDirs) {
    const dir = join(TARGET_DIR, type, name);
    if (await Bun.file(join(dir, "config.yml")).exists()) {
      await Bun.spawn(["rm", "-rf", dir]).exited;
      return;
    }
  }
  die(`Target "${name}" not found.\nRun: clip list  — to see registered targets.`);
}

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
