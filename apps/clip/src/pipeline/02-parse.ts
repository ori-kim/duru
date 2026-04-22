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
  "add", "list", "remove", "skills", "bind", "unbind", "binds",
  "completion", "profile", "alias", "refresh", "login", "logout",
  "config", "workspace",
]);

let _internalVerbSet: Set<string> = DEFAULT_INTERNAL_VERBS;

export function setInternalVerbSet(verbs: Set<string>): void {
  _internalVerbSet = verbs;
}

const LATE_FLAG_SET = new Set(["--dry-run", "--json", "--pipe", "--debug", "--format"]);

// cli/parser.ts re-export 호환용 — process.exit 포함 기존 동작 유지
export function parseGlobalFlags(argv: string[]): {
  jsonMode: boolean;
  pipeMode: boolean;
  dryRun: boolean;
  configPath: string | undefined;
  rest: string[];
} {
  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  let i = 0;

  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--json") {
      jsonMode = true;
      i++;
    } else if (a === "--pipe") {
      pipeMode = true;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
      i++;
    } else if (a === "--debug") {
      process.env["CLIP_EXT_TRACE"] = "1";
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--version" || a === "-v") {
      console.log(`clip ${VERSION}`);
      process.exit(0);
    } else if ((a === "--config" || a === "-c") && argv[i + 1]) {
      configPath = argv[++i];
      i++;
    } else {
      break;
    }
  }

  return { jsonMode, pipeMode, dryRun, configPath, rest: argv.slice(i) };
}

export function parseInvocation(raw: RawInvocation): ParsedInvocation {
  const { argv, env, at } = raw as unknown as RawData;
  const argvArr = [...argv];

  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  let internalVerb: string | undefined;
  let i = 0;

  // global flags 스캔 (argv 선두)
  while (i < argvArr.length) {
    const a = argvArr[i] ?? "";
    if (a === "--json") {
      jsonMode = true;
      i++;
    } else if (a === "--pipe") {
      pipeMode = true;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
      i++;
    } else if (a === "--debug") {
      process.env["CLIP_EXT_TRACE"] = "1";
      i++;
    } else if (a === "--help" || a === "-h") {
      internalVerb = "help";
      i++;
      break;
    } else if (a === "--version" || a === "-v") {
      internalVerb = "version";
      i++;
      break;
    } else if ((a === "--config" || a === "-c") && argvArr[i + 1]) {
      configPath = argvArr[++i];
      i++;
    } else {
      break;
    }
  }

  const rest = argvArr.slice(i);

  let token: string | undefined;
  let baseName: string | undefined;
  let explicitProfile: string | undefined;
  let rawTargetArgs: string[];

  if (!internalVerb && rest.length > 0) {
    const first = rest[0]!;
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
  let effectiveFormat: string | undefined;
  const filteredArgs: string[] = [];

  for (let i = 0; i < rawTargetArgs.length; i++) {
    const a = rawTargetArgs[i] ?? "";
    if (a === "--dry-run") {
      effectiveDryRun = true;
    } else if (a === "--json") {
      effectiveJsonMode = true;
    } else if (a === "--pipe") {
      effectivePipeMode = true;
    } else if (a === "--debug") {
      process.env["CLIP_EXT_TRACE"] = "1";
    } else if (a === "--format") {
      effectiveFormat = rawTargetArgs[++i] ?? "plain";
    } else {
      filteredArgs.push(a);
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
      ...(effectiveFormat !== undefined ? { format: effectiveFormat } : {}),
    },
    configPath,
    internalVerb,
  };

  return parsed as unknown as ParsedInvocation;
}
