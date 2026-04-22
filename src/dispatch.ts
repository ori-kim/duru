import { checkAcl } from "./acl.ts";
import { type HasAliases, resolveAlias } from "./commands/alias.ts";
import type { Config, ResolvedTarget } from "./config.ts";
import type { ErrorCtx, ExecutorContext, TargetResult } from "./extension.ts";
import type { HookCtx, Registry } from "./extension.ts";

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

function shouldCheckAcl(skipSubcommands: string[] | undefined, type: string, subcommand: string): boolean {
  if (subcommand === "tools" && type !== "cli") return false;
  if (skipSubcommands && skipSubcommands.includes(subcommand)) return false;
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

  // toolcall 훅 (관찰 전용)
  const baseCtx: HookCtx = {
    phase: "toolcall",
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
    await reg.runHooks("toolcall", baseCtx);

    const def = reg.getTargetType(type);
    if (!def) throw new Error(`Unknown target type: "${type}"`);

    // ACL 검사
    if (shouldCheckAcl(def.aclRule?.skipSubcommands, type, subcommand)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        checkAcl(target as any, subcommand, args[0], input.targetName);
      } catch (e) {
        aclDenied = true;
        throw e;
      }
    }

    // beforeExecute 훅
    const beforeCtx: HookCtx = { ...baseCtx, phase: "beforeExecute" };
    const beforeResult = await reg.runHooks("beforeExecute", beforeCtx);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let validTarget: any = target;
    const isExtension = cfg._ext?.[type]?.[input.targetName] !== undefined;
    if (isExtension) {
      const parsed = def.schema.safeParse(target);
      if (!parsed.success) throw new Error(`Invalid config for "${input.targetName}": ${parsed.error.message}`);
      validTarget = parsed.data;
    }

    let result = await def.executor(validTarget, ctx);

    // afterExecute 훅 — rewrite된 값으로 ctx 구성
    const afterCtx: HookCtx = {
      ...baseCtx,
      phase: "afterExecute",
      subcommand: effectiveSubcommand,
      args: effectiveArgs,
      headers: effectiveHeaders,
      result,
    };
    const afterResult = await reg.runHooks("afterExecute", afterCtx);

    if (afterResult && "result" in afterResult) {
      result = { ...result, ...(afterResult as { result: Partial<TargetResult> }).result };
    }

    return result;
  } catch (e) {
    const errorCtx: ErrorCtx = {
      ...baseCtx,
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
