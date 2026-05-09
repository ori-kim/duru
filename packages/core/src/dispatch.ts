import { checkAcl } from "./acl.ts";
import { type HasAliases, resolveAlias } from "./alias.ts";
import type { AclTree, Config, ResolvedTarget } from "./config.ts";
import type { ErrorCtx, ExecutorContext, TargetResult } from "./extension.ts";
import type { Registry, TargetHookCtx } from "./extension.ts";

export type DispatchInput = {
  targetName: string;
  resolvedTarget: ResolvedTarget;
  subcommand: string;
  args: string[];
  headers: Record<string, string>;
  dryRun: boolean;
  jsonMode: boolean;
  passthrough: boolean;
  env: Record<string, string>;
};

type AclCheckTarget = {
  allow?: string[];
  deny?: string[];
  acl?: AclTree;
};

function shouldCheckAcl(skipSubcommands: string[] | undefined, type: string, subcommand: string): boolean {
  if (["tools", "refresh", "describe", "schema"].includes(subcommand) && type !== "cli") return false;
  if (skipSubcommands?.includes(subcommand)) return false;
  return true;
}

export async function dispatch(cfg: Config, input: DispatchInput, registry: Registry): Promise<TargetResult> {
  const reg = registry;
  const { type, target } = input.resolvedTarget;

  // alias 확장
  const targetEnv = (target as { env?: Record<string, string> }).env ?? {};
  const aliasHit = resolveAlias(
    target as HasAliases,
    input.subcommand,
    input.args.filter((a) => a !== "--help" && a !== "-h"),
    { ...input.env, ...targetEnv },
  );
  const subcommand = aliasHit?.subcommand ?? input.subcommand;
  const args = aliasHit?.args ?? input.args;

  const baseCtx: TargetHookCtx = {
    phase: "target-start",
    targetName: input.targetName,
    targetType: type,
    target: Object.freeze(target),
    subcommand,
    args,
    headers: input.headers,
    dryRun: input.dryRun,
    jsonMode: input.jsonMode,
    passthrough: input.passthrough,
  };

  let aclDenied = false;
  let effectiveSubcommand = subcommand;
  let effectiveArgs = args;
  let effectiveHeaders = input.headers;

  try {
    const def = reg.getTargetType(type);
    if (!def) throw new Error(`Unknown target type: "${type}"`);

    // ACL 검사
    if (shouldCheckAcl(def.aclRule?.skipSubcommands, type, subcommand)) {
      try {
        checkAcl(target as AclCheckTarget, subcommand, args[0], input.targetName);
      } catch (e) {
        aclDenied = true;
        throw e;
      }
    }

    // target-start 훅
    const beforeResult = await reg.runHooks("target-start", baseCtx);

    if (beforeResult && "shortCircuit" in beforeResult) {
      return beforeResult.shortCircuit;
    }

    effectiveHeaders =
      beforeResult && "headers" in beforeResult && beforeResult.headers
        ? { ...input.headers, ...beforeResult.headers }
        : input.headers;
    effectiveArgs =
      beforeResult && "args" in beforeResult && beforeResult.args !== undefined ? beforeResult.args : args;
    effectiveSubcommand =
      beforeResult && "subcommand" in beforeResult && beforeResult.subcommand ? beforeResult.subcommand : subcommand;

    // executor 실행
    const ctx: ExecutorContext = {
      targetName: input.targetName,
      subcommand: effectiveSubcommand,
      args: effectiveArgs,
      headers: effectiveHeaders,
      dryRun: input.dryRun,
      jsonMode: input.jsonMode,
      passthrough: input.passthrough,
    };

    // extension 타겟은 raw config를 dispatch 시에 schema로 검증
    // builtin 타겟은 loadConfig()에서 이미 검증+normalizeConfig 완료된 상태
    let validTarget: unknown = target;
    const isExtension = cfg._ext?.[type]?.[input.targetName] !== undefined;
    if (isExtension) {
      const parsed = def.schema.safeParse(target);
      if (!parsed.success) throw new Error(`Invalid config for "${input.targetName}": ${parsed.error.message}`);
      validTarget = parsed.data;
    }

    let result = await def.executor(validTarget, ctx);

    // target-end 훅 — rewrite된 값으로 ctx 구성
    const afterCtx: TargetHookCtx = {
      ...baseCtx,
      phase: "target-end",
      subcommand: effectiveSubcommand,
      args: effectiveArgs,
      headers: effectiveHeaders,
      result,
    };
    const afterResult = await reg.runHooks("target-end", afterCtx);

    if (afterResult && "result" in afterResult) {
      result = { ...result, ...(afterResult as { result: Partial<TargetResult> }).result };
    }

    return result;
  } catch (e) {
    const errorCtx: ErrorCtx = {
      ...baseCtx,
      phase: "target-error",
      subcommand: effectiveSubcommand,
      args: effectiveArgs,
      headers: effectiveHeaders,
      error: e,
      aclDenied,
    };
    const handled = await reg.runErrorHandlers(errorCtx);
    if (handled && "result" in handled) return (handled as { result: TargetResult }).result;
    if (handled && "rethrow" in handled) throw (handled as { rethrow: unknown }).rethrow;
    throw e;
  }
}
