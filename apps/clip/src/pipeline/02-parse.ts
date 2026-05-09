import type { OptionSpec, OptionValue } from "@clip/core";
import { HELP, VERSION } from "../cli/help.ts";
import type { LateFlags, ParsedInvocation, RawInvocation } from "./types.ts";

type RawData = { argv: readonly string[]; env: Readonly<Record<string, string>>; at: number };
type ParsedData = {
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  at: number;
  token: string | undefined;
  baseName: string | undefined;
  explicitProfile: string | undefined;
  userArgs: readonly string[];
  lateFlags: LateFlags;
  configPath: string | undefined;
  internalVerb: string | "help" | "version" | undefined;
};

// 동적 verb 세트: builtin-loader 또는 clip.ts에서 주입한다.
// Registry 초기화 전에 parse가 호출될 수 있어 모듈 수준 Set을 공유 상태로 사용.
// 기본값: builtin internal commands (테스트 및 registry 초기화 이전 호환용)
const DEFAULT_INTERNAL_VERBS = new Set([
  "add",
  "list",
  "remove",
  "bind",
  "unbind",
  "binds",
  "completion",
  "profile",
  "alias",
  "refresh",
  "login",
  "logout",
  "update",
  "config",
  "ext",
]);

let _internalVerbSet: Set<string> = DEFAULT_INTERNAL_VERBS;

export function setInternalVerbSet(verbs: Set<string>): void {
  _internalVerbSet = verbs;
}

const DEFAULT_GLOBAL_OPTIONS: OptionSpec[] = [
  { name: "json-output", type: "boolean", aliases: ["json"], placement: "any" },
  { name: "pipe", type: "boolean", placement: "any" },
  { name: "dry-run", type: "boolean", placement: "any" },
  { name: "debug", type: "boolean", placement: "any" },
  { name: "format", type: "value", placement: "any", valueName: "format" },
  { name: "config", type: "value", aliases: ["c"], placement: "leading", valueName: "path" },
  { name: "help", type: "boolean", aliases: ["h"], placement: "leading" },
  { name: "version", type: "boolean", aliases: ["v"], placement: "leading" },
];

let _globalOptionSpecs = DEFAULT_GLOBAL_OPTIONS;

export function setGlobalOptionSpecs(options: OptionSpec[]): void {
  _globalOptionSpecs = options.length > 0 ? options : DEFAULT_GLOBAL_OPTIONS;
}

function normalizeFlagName(arg: string): { name: string; inlineValue?: string } | null {
  if (!arg.startsWith("-")) return null;
  if (arg.startsWith("--")) {
    const raw = arg.slice(2);
    const eq = raw.indexOf("=");
    if (eq >= 0) return { name: raw.slice(0, eq), inlineValue: raw.slice(eq + 1) };
    return { name: raw };
  }
  if (arg.length === 2) return { name: arg.slice(1) };
  return null;
}

function findGlobalOption(arg: string): { spec: OptionSpec; inlineValue?: string } | null {
  const parsed = normalizeFlagName(arg);
  if (!parsed) return null;
  for (const spec of _globalOptionSpecs) {
    if (spec.name === parsed.name || spec.aliases?.includes(parsed.name))
      return { spec, inlineValue: parsed.inlineValue };
  }
  return null;
}

function assignOption(out: Record<string, OptionValue>, name: string, value: OptionValue): void {
  out[name] = value;
}

// cli/parser.ts re-export 호환용 — process.exit 포함 기존 동작 유지
export function parseGlobalFlags(argv: string[]): {
  jsonMode: boolean;
  pipeMode: boolean;
  dryRun: boolean;
  configPath: string | undefined;
  options: Record<string, OptionValue>;
  rest: string[];
} {
  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  const options: Record<string, OptionValue> = {};
  let i = 0;

  while (i < argv.length) {
    const a = argv[i] ?? "";
    const found = findGlobalOption(a);
    if (!found) break;
    const { spec, inlineValue } = found;

    if (spec.type === "value") {
      const value = inlineValue ?? argv[i + 1];
      if (value === undefined) break;
      assignOption(options, spec.name, value);
      if (spec.name === "config") configPath = value;
      if (spec.name === "format") {
        // parseGlobalFlags legacy return has no format slot; keep it in options only.
      }
      i += inlineValue === undefined ? 2 : 1;
      continue;
    }

    assignOption(options, spec.name, true);
    if (spec.name === "json-output") {
      jsonMode = true;
      i++;
    } else if (spec.name === "pipe") {
      pipeMode = true;
      i++;
    } else if (spec.name === "dry-run") {
      dryRun = true;
      i++;
    } else if (spec.name === "debug") {
      process.env.CLIP_EXT_TRACE = "1";
      i++;
    } else if (spec.name === "help") {
      console.log(HELP);
      process.exit(0);
    } else if (spec.name === "version") {
      console.log(`clip ${VERSION}`);
      process.exit(0);
    } else {
      i++;
    }
  }

  return { jsonMode, pipeMode, dryRun, configPath, options, rest: argv.slice(i) };
}

export function parseInvocation(raw: RawInvocation): ParsedInvocation {
  const { argv, env, at } = raw as unknown as RawData;
  const argvArr = [...argv];

  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  let internalVerb: string | undefined;
  const globalOptions: Record<string, OptionValue> = {};
  let i = 0;

  // global flags 스캔 (argv 선두)
  while (i < argvArr.length) {
    const a = argvArr[i] ?? "";
    const found = findGlobalOption(a);
    if (!found) break;
    const { spec, inlineValue } = found;
    if (spec.placement === "any" || spec.placement === "leading" || spec.placement === undefined) {
      if (spec.type === "value") {
        const value = inlineValue ?? argvArr[i + 1];
        if (value === undefined) break;
        assignOption(globalOptions, spec.name, value);
        if (spec.name === "config") configPath = value;
        i += inlineValue === undefined ? 2 : 1;
        continue;
      }
      assignOption(globalOptions, spec.name, true);
    }

    if (spec.name === "json-output") {
      jsonMode = true;
      i++;
    } else if (spec.name === "pipe") {
      pipeMode = true;
      i++;
    } else if (spec.name === "dry-run") {
      dryRun = true;
      i++;
    } else if (spec.name === "debug") {
      process.env.CLIP_EXT_TRACE = "1";
      i++;
    } else if (spec.name === "help") {
      internalVerb = "help";
      i++;
      break;
    } else if (spec.name === "version") {
      internalVerb = "version";
      i++;
      break;
    } else {
      i++;
    }
  }

  const rest = argvArr.slice(i);

  let token: string | undefined;
  let baseName: string | undefined;
  let explicitProfile: string | undefined;
  let rawTargetArgs: string[];

  if (!internalVerb && rest.length > 0) {
    const first = rest[0] ?? "";
    if (_internalVerbSet.has(first)) {
      internalVerb = first;
      rawTargetArgs = rest.slice(1);
    } else {
      // @profile 분리
      token = first;
      const atIdx = first.indexOf("@");
      baseName = atIdx >= 0 ? first.slice(0, atIdx) : first;
      explicitProfile = atIdx >= 0 ? first.slice(atIdx + 1) : undefined;
      rawTargetArgs = rest.slice(1);
    }
  } else {
    rawTargetArgs = rest;
  }

  // LATE_FLAGS 필터링 + global OR 병합
  let effectiveDryRun = dryRun;
  let effectiveJsonMode = jsonMode;
  let effectivePipeMode = pipeMode;
  let effectiveFormat: string | undefined =
    typeof globalOptions.format === "string" ? (globalOptions.format as string) : undefined;
  const effectiveOptions: Record<string, OptionValue> = { ...globalOptions };
  const filteredArgs: string[] = [];

  if (internalVerb && !token) {
    filteredArgs.push(...rawTargetArgs);
  } else {
    for (let i = 0; i < rawTargetArgs.length; i++) {
      const a = rawTargetArgs[i] ?? "";
      const found = findGlobalOption(a);
      if (found && (found.spec.placement ?? "leading") === "any") {
        const { spec, inlineValue } = found;
        if (spec.type === "value") {
          const value = inlineValue ?? rawTargetArgs[++i];
          if (value !== undefined) {
            assignOption(effectiveOptions, spec.name, value);
            if (spec.name === "format") effectiveFormat = value;
          }
        } else {
          assignOption(effectiveOptions, spec.name, true);
          if (spec.name === "dry-run") effectiveDryRun = true;
          if (spec.name === "json-output") effectiveJsonMode = true;
          if (spec.name === "pipe") effectivePipeMode = true;
          if (spec.name === "debug") process.env.CLIP_EXT_TRACE = "1";
        }
      } else if (a === "--dry-run") {
        effectiveDryRun = true;
      } else if (a === "--json" || a === "--json-output") {
        effectiveJsonMode = true;
      } else if (a === "--pipe") {
        effectivePipeMode = true;
      } else if (a === "--debug") {
        process.env.CLIP_EXT_TRACE = "1";
      } else if (a === "--format") {
        effectiveFormat = rawTargetArgs[++i] ?? "plain";
      } else {
        filteredArgs.push(a);
      }
    }
  }

  const parsed: ParsedData = {
    argv,
    env,
    at,
    token,
    baseName,
    explicitProfile,
    userArgs: Object.freeze(filteredArgs) as readonly string[],
    lateFlags: {
      jsonMode: effectiveJsonMode,
      pipeMode: effectivePipeMode,
      dryRun: effectiveDryRun,
      options: effectiveOptions,
      ...(effectiveFormat !== undefined ? { format: effectiveFormat } : {}),
    },
    configPath,
    internalVerb,
  };

  return parsed as unknown as ParsedInvocation;
}
