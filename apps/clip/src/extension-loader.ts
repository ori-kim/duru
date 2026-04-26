/**
 * extension-loader.ts — 단일 루트 manifest 기반 2-phase lifecycle
 *
 * Phase 1 (meta-register): extensions.yml 읽기 → contributes 인덱싱만 수행 (import 없음)
 * Phase 2 (lazy init):     argv 매칭 시에만 → await import() + init(api)
 *
 * Phase 2 선택 규칙:
 *   - hooks 선언 entry (contributes.hooks.length > 0) → eager: 항상 init
 *   - hooks 없는 entry → argv의 verb/target이 contributes.internalCommands 또는
 *     contributes.targetTypes와 일치할 때만 init (일치 없으면 import 자체 skip)
 *
 * 환경변수:
 *   CLIP_EXT_MANIFEST   — manifest 파일 경로 override (기본: ~/.clip/extensions/extensions.yml)
 *   CLIP_NO_EXTENSIONS  — "1" 이면 user extension 전체 skip
 *   CLIP_EXT_TRACE      — "1" 이면 stderr 로그
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { ClipExtension, ExtensionApi, Registry, TargetTypeManifestSpec } from "@clip/core";
import { CONFIG_DIR } from "@clip/core";

// ---------------------------------------------------------------------------
// manifest 스키마 타입
// ---------------------------------------------------------------------------

export type ContributesSpec = {
  internalCommands?: string[];
  targetTypes?: (string | TargetTypeManifestSpec)[];
  hooks?: string[];
  outputFormats?: string[];
  initOrder?: number;
};

export type ExtensionEntry = {
  name: string;
  path: string;
  entry: string;
  enabled?: boolean;
  builtin?: boolean;          // 내장 extension 마킹 (user manifest에는 없음)
  contributes?: ContributesSpec;
};

export type ManifestDefaults = {
  enabled?: boolean;
};

export type ExtensionManifest = {
  defaults?: ManifestDefaults;
  extensions: ExtensionEntry[];
};

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

function trace(msg: string): void {
  if (process.env["CLIP_EXT_TRACE"] === "1") process.stderr.write(`[clip:ext] ${msg}\n`);
}

function warn(msg: string): void {
  process.stderr.write(`clip: warning: ${msg}\n`);
}

function getManifestPath(): string {
  return process.env["CLIP_EXT_MANIFEST"] ?? join(CONFIG_DIR, "extensions", "extensions.yml");
}

// ---------------------------------------------------------------------------
// Phase 1: manifest 읽기 및 인덱싱 (import 없음)
// ---------------------------------------------------------------------------

function loadManifest(manifestPath: string): ExtensionManifest | null {
  if (!existsSync(manifestPath)) {
    trace(`manifest not found: ${manifestPath}`);
    return null;
  }
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = yamlParse(raw) as ExtensionManifest | null;
    if (!parsed || !Array.isArray(parsed.extensions)) {
      warn(`manifest at ${manifestPath} is malformed (expected extensions array)`);
      return null;
    }
    return parsed;
  } catch (e) {
    warn(`failed to read manifest ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function normalizeTypeSpecs(types: (string | TargetTypeManifestSpec)[]): TargetTypeManifestSpec[] {
  return types.map((t) => (typeof t === "string" ? { name: t } : t));
}

// entry 경로를 절대 경로로 해석
function resolveEntryPath(entry: ExtensionEntry, manifestDir: string): string {
  const entryPath = join(entry.path, entry.entry);
  if (isAbsolute(entryPath)) return entryPath;
  return resolve(manifestDir, entryPath);
}

// ---------------------------------------------------------------------------
// Phase 2: 단일 entry lazy import
// ---------------------------------------------------------------------------

async function importEntry(
  entryAbsPath: string,
  entry: ExtensionEntry,
): Promise<ClipExtension | null> {
  trace(`importing extension entry: ${entryAbsPath}`);
  try {
    const mod = await import(entryAbsPath);
    const ext: ClipExtension | undefined =
      mod.extension ?? mod.default?.extension ?? mod.default;
    if (!ext || typeof ext.name !== "string" || typeof ext.init !== "function") {
      warn(`extension "${entry.name}" (${entryAbsPath}) must export { extension: ClipExtension }`);
      return null;
    }
    return ext;
  } catch (e) {
    warn(`failed to import extension "${entry.name}": ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공개 타입: loader 반환물
// ---------------------------------------------------------------------------

export type LoadedExtensionEntry = {
  entry: ExtensionEntry;
  entryAbsPath: string;
  initialized: boolean;
};

export type ExtensionLoader = {
  /**
   * Phase 1: manifest를 읽어 인덱싱. import는 하지 않음.
   * manifest 없으면 user entry 0개.
   */
  phase1Entries: LoadedExtensionEntry[];

  /**
   * Phase 1에서 수집한 user extension의 internalCommands 전체 세트.
   * main.ts에서 setInternalVerbSet()에 포함시켜 parseInvocation이 올바르게 분류할 수 있게 한다.
   * Phase 2 init 여부와 관계없이 manifest에 선언된 verb는 모두 포함된다.
   */
  phase1InternalVerbs: Set<string>;

  /**
   * Phase 2 (type-matched): bindTarget() 이후 실제 target type이 확정된 뒤 호출.
   * contributes.targetTypes에 actualType이 선언된 entry만 import + init한다.
   * registry.initOne()을 통해 Registry 내부 api를 재사용.
   */
  initMatchingType: (actualType: string, registry: Registry) => Promise<void>;

  /** 모든 등록된 entry (builtin 포함) 반환 — `clip ext list` 용 */
  listEntries: () => ExtensionEntry[];
};

// ---------------------------------------------------------------------------
// argv 매칭 헬퍼 — Phase 2 init 여부 결정
// ---------------------------------------------------------------------------

/**
 * argv에서 첫 번째 non-flag 토큰(verb)을 추출한다.
 * global flag(--json, --dry-run 등)는 건너뛴다.
 */
function extractVerb(argv: string[]): string | undefined {
  const GLOBAL_FLAGS = new Set(["--json", "--pipe", "--dry-run", "--debug"]);
  const VALUE_FLAGS = new Set(["--config", "-c"]); // 다음 토큰이 값인 플래그
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (VALUE_FLAGS.has(a)) { i += 2; continue; } // 플래그 + 값 모두 skip
    if (a.startsWith("-")) { if (!GLOBAL_FLAGS.has(a)) { i++; continue; } i++; continue; }
    return a; // 첫 번째 positional
  }
  return undefined;
}

/**
 * entry의 Phase 2 (hooks/internalCommands) init이 필요한지 판단한다.
 *
 * - hasHooks → 항상 init (eager)
 * - argv의 verb가 contributes.internalCommands에 있음 → init
 * - targetTypes 선언 entry는 이 함수에서 판단하지 않는다.
 *   실제 target type이 확정된 뒤 initMatchingType()에서 별도 처리한다.
 * - 그 외 → skip
 */
// Verbs that need full extension metadata (descriptions, completion contributors, etc.)
const METADATA_VERBS = new Set(["list", "completion"]);

function shouldInit(
  entry: ExtensionEntry,
  argv: string[] | undefined,
  hasHooks: boolean,
): boolean {
  if (hasHooks) return true;

  const verb = argv ? extractVerb(argv) : undefined;
  if (!verb) return false;

  // list / completion need all extension metadata — init everything
  if (METADATA_VERBS.has(verb)) return true;

  const cmds = entry.contributes?.internalCommands ?? [];
  if (cmds.includes(verb)) {
    trace(`[lazy-match] "${entry.name}" matched internalCommand "${verb}"`);
    return true;
  }

  trace(`[lazy-skip] "${entry.name}" — no match for argv verb "${verb}"`);
  return false;
}

// ---------------------------------------------------------------------------
// 메인 export: loadUserExtensions
// ---------------------------------------------------------------------------

/**
 * Registry를 받아 manifest 기반으로 user extension을 준비한다.
 * argv를 기반으로 Phase 2 (import + init)를 선택적으로 수행한다.
 *
 * - hooks 선언 entry: registry.initAll() 시점에 항상 import + init (eager)
 * - hooks 없는 entry: argv의 verb가 contributes와 일치할 때만 import + init
 *   일치하지 않으면 import 자체가 발생하지 않음
 *
 * 반환값: ExtensionLoader (clip ext 서브커맨드에서 활용)
 */
export async function loadUserExtensions(
  registry: Registry,
  argv?: string[],
): Promise<ExtensionLoader> {
  if (process.env["CLIP_NO_EXTENSIONS"] === "1") {
    trace("CLIP_NO_EXTENSIONS=1, skipping user extensions");
    return makeEmptyLoader();
  }

  const manifestPath = getManifestPath();
  const manifest = loadManifest(manifestPath);
  const manifestDir = dirname(manifestPath);

  const phase1Entries: LoadedExtensionEntry[] = [];

  if (!manifest) {
    trace("no manifest found — 0 user extensions");
    return makeEmptyLoader();
  }

  const globalEnabled = manifest.defaults?.enabled ?? true;

  // initOrder 기준 정렬
  const sorted = [...manifest.extensions].sort(
    (a, b) => (a.contributes?.initOrder ?? 0) - (b.contributes?.initOrder ?? 0),
  );

  for (const entry of sorted) {
    const enabled = entry.enabled ?? globalEnabled;
    if (!enabled) {
      trace(`extension "${entry.name}" disabled in manifest`);
      continue;
    }

    const entryAbsPath = resolveEntryPath(entry, manifestDir);
    phase1Entries.push({ entry, entryAbsPath, initialized: false });
    trace(`[phase1] indexed extension "${entry.name}" (${entryAbsPath})`);
  }

  // registry에 lazy wrapper로 등록
  // initAll() 시점에 shouldInit() 판단 후 선택적으로 import + init
  // targetTypes extension은 여기서 등록하지 않고 initMatchingType()에서 처리
  for (const loaded of phase1Entries) {
    const { entry, entryAbsPath } = loaded;
    const hasHooks = (entry.contributes?.hooks ?? []).length > 0;
    const hasOnlyTargetTypes =
      !hasHooks &&
      (entry.contributes?.internalCommands ?? []).length === 0 &&
      normalizeTypeSpecs(entry.contributes?.targetTypes ?? []).length > 0;

    if (hasOnlyTargetTypes) {
      // targetTypes 전용 extension — initMatchingType()에서 lazy init
      trace(`[type-lazy] "${entry.name}" — deferred until type is known`);
      continue;
    }

    if (hasHooks) {
      trace(`[eager] hooks-declaring extension "${entry.name}" — will always init at initAll()`);
    } else {
      trace(`[lazy] "${entry.name}" — init only when argv matches contributes`);
    }

    registry.register(makeLazyExtension(entry, entryAbsPath, loaded, hasHooks, argv));
  }

  // Phase 1에서 선언된 internalCommands 전체 수집 (enabled entry만)
  const phase1InternalVerbs = new Set<string>();
  for (const { entry } of phase1Entries) {
    for (const verb of entry.contributes?.internalCommands ?? []) {
      phase1InternalVerbs.add(verb);
    }
  }

  const loader: ExtensionLoader = {
    phase1Entries,
    phase1InternalVerbs,

    initMatchingType: async (actualType: string, reg: Registry) => {
      // bindTarget() 이후 호출. actualType과 매칭되는 targetTypes entry만 init.
      for (const loaded of phase1Entries) {
        const { entry, entryAbsPath } = loaded;
        const typeSpecs = normalizeTypeSpecs(entry.contributes?.targetTypes ?? []);
        const matchedSpec = typeSpecs.find((s) => s.name === actualType);
        if (!matchedSpec) continue;
        if (loaded.initialized) {
          trace(`[type-lazy-skip] "${entry.name}" already initialized`);
          continue;
        }
        trace(`[type-lazy-init] "${entry.name}" matched type "${actualType}"`);
        const ext = await importEntry(entryAbsPath, entry);
        if (!ext) continue;
        if (!reg.hasExtension(`user:${entry.name}`)) {
          reg.register({ name: `user:${entry.name}`, init: ext.init.bind(ext), dispose: ext.dispose?.bind(ext) });
        }
        await reg.initOne(`user:${entry.name}`);
        // manifest argSpec/displayHint override가 있으면 Registry에 적용
        const { name: _, ...override } = matchedSpec;
        if (Object.keys(override).length > 0) {
          reg.applyManifestOverride(actualType, override);
        }
        loaded.initialized = true;
      }
    },

    listEntries: () => phase1Entries.map((l) => l.entry),
  };

  return loader;
}

// ---------------------------------------------------------------------------
// lazy extension wrapper
// ---------------------------------------------------------------------------

function makeLazyExtension(
  entry: ExtensionEntry,
  entryAbsPath: string,
  loaded: LoadedExtensionEntry,
  hasHooks: boolean,
  argv: string[] | undefined,
): ClipExtension {
  return {
    name: `user:${entry.name}`,
    async init(api: ExtensionApi) {
      // Phase 2 선택: shouldInit이 false이면 import 자체를 건너뜀
      if (!shouldInit(entry, argv, hasHooks)) {
        trace(`[phase2-skip] "${entry.name}" — no argv match, import skipped`);
        return;
      }
      const ext = await importEntry(entryAbsPath, entry);
      if (!ext) return;
      await ext.init(api);
      loaded.initialized = true;
      trace(`[phase2] initialized extension "${entry.name}"`);
    },
  };
}

// ---------------------------------------------------------------------------
// empty loader (manifest 없음 / CLIP_NO_EXTENSIONS=1)
// ---------------------------------------------------------------------------

function makeEmptyLoader(): ExtensionLoader {
  return {
    phase1Entries: [],
    phase1InternalVerbs: new Set(),
    initMatchingType: async () => {},
    listEntries: () => [],
  };
}

// ---------------------------------------------------------------------------
// manifest 편집 헬퍼 — clip ext enable/disable 용
// ---------------------------------------------------------------------------

export function setExtensionEnabled(name: string, enabled: boolean): void {
  const manifestPath = getManifestPath();
  const manifest = loadManifest(manifestPath);

  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}. Create it first.`);
  }

  const entry = manifest.extensions.find((e) => e.name === name);
  if (!entry) {
    throw new Error(`Extension "${name}" not found in manifest.`);
  }

  entry.enabled = enabled;

  const yaml = yamlStringify(manifest);
  writeFileSync(manifestPath, yaml, "utf8");
  trace(`set extension "${name}" enabled=${enabled} in ${manifestPath}`);
}

// ---------------------------------------------------------------------------
// 공개 타입 re-export
// ---------------------------------------------------------------------------

export type { ExtensionManifest as Manifest };
