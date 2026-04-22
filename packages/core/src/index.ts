/**
 * @clip/core — 공개 API
 *
 * 외부 프로젝트는 이 파일을 통해서만 core 내부에 접근한다.
 * core 내부 파일(extension.ts, config.ts 등)을 직접 import하지 않는다.
 */

// Extension 시스템 — 타입
export type {
  ExtensionApi,
  ClipExtension,
  TargetTypeContribution,
  NormalizeCtx,
  TargetTypeDef,
  HookPhase,
  HookFn,
  HookOpts,
  HookCtx,
  HookReturn,
  ErrorHandler,
  ErrorCtx,
  ErrorReturn,
  InternalCommandHandler,
  InternalCommandCtx,
  Executor,
  Logger,
} from "./extension.ts";

// Extension 시스템 — 피드백 요청 추가 타입
export type { AddArgs, ListOpts, ArgSpec, DisplayHint, TargetTypeManifestSpec } from "./extension.ts";

// Registry 클래스
export { Registry } from "./extension.ts";

// 출력 레이어
export type {
  ExecutionResult,
  ResultMeta,
  OutputRenderer,
  RenderOpts,
  ResultPresenter,
  TargetResult,
  Tool,
} from "./utils/output.ts";

// Config
export type { Config, ResolvedTarget } from "./config.ts";
export { loadConfig, CONFIG_DIR, TARGET_DIR, findTargetConfigDir, addTarget } from "./config.ts";
export {
  getTarget,
  updateTarget,
  removeTarget,
  getAllTargetNames,
  mergeHeaders,
  profileOverrideSchema,
} from "./config.ts";

// Dispatch
export { dispatch } from "./dispatch.ts";

// ExecutorContext — builtin extension들이 사용
export type { ExecutorContext } from "./extension.ts";

// Errors — extension에서 사용하는 오류 유틸
export { die, ClipError, printAndExit } from "./utils/errors.ts";

// Env substitution — builtin normalizeConfig에서 사용
export { subRecord, subProfiles } from "./utils/env-sub.ts";

// Alias — extension executor의 tools 출력에서 사용
export { buildAliasSection, listAliases, resolveAlias, expandArgs, expandInput, flattenInput, formatAliasDef } from "./alias.ts";
export type { HasAliases } from "./alias.ts";

// Tool args — extension executor에서 공통 사용
export { parseToolArgs, formatToolHelp, extractHelpFlag } from "./utils/tool-args.ts";

// Target schema helpers — extension schema 정의에서 사용
export { aclFields, aliasFields, profileFields, commonTargetFields } from "./utils/target-schema.ts";
export type { ProfileOverride, AliasDef, AclNode, AclTree } from "./utils/target-schema.ts";

// ACL
export { checkAcl } from "./acl.ts";

// OutputRegistry
export { OutputRegistry, outputRegistry } from "./output-registry.ts";
