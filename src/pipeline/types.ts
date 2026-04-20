import type { TargetResult } from "../extension.ts";

// --- Brand System ---

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

// --- Internal Verbs ---

export type InternalVerb =
  | "add"
  | "list"
  | "remove"
  | "skills"
  | "bind"
  | "unbind"
  | "binds"
  | "completion"
  | "profile"
  | "alias"
  | "refresh"
  | "login"
  | "logout"
  | "config";

// --- Late Flags ---

export type LateFlags = {
  jsonMode: boolean;
  pipeMode: boolean;
  dryRun: boolean;
};

// --- Stage 1: RawInvocation ---

type RawInvocationData = {
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  at: number;
};

export type RawInvocation = Brand<RawInvocationData, "RawInvocation">;

// --- Stage 2: ParsedInvocation ---

type ParsedInvocationData = {
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  at: number;
  token: string | undefined;
  baseName: string | undefined;
  explicitProfile: string | undefined;
  userArgs: readonly string[];
  lateFlags: LateFlags;
  configPath: string | undefined;
  internalVerb: InternalVerb | "help" | "version" | undefined;
};

export type ParsedInvocation = Brand<ParsedInvocationData, "ParsedInvocation">;

// --- Stage 3: MatchedCommand ---

export type TargetInvocationHandle = {
  baseName: string;
  explicitProfile: string | undefined;
  token: string;
  userArgs: readonly string[];
  lateFlags: LateFlags;
  subcommand: string | undefined;
  targetArgs: readonly string[];
};

export type MatchedInternal = { kind: "internal"; verb: InternalVerb; rest: readonly string[] };
export type MatchedHelp = { kind: "help"; what: "top" | { target: string } };
export type MatchedCompletion = { kind: "completion"; shell: readonly string[] };
export type MatchedTarget = { kind: "target"; invocation: TargetInvocationHandle };

export type MatchedCommand = Brand<
  MatchedInternal | MatchedHelp | MatchedCompletion | MatchedTarget,
  "MatchedCommand"
>;

// --- Stage 4: BoundTarget ---

type BoundTargetData = {
  invocation: TargetInvocationHandle;
  type: string;
  rawTarget: unknown;
  configDir: string;
};

export type BoundTarget = Brand<BoundTargetData, "BoundTarget">;

// --- Stage 5: MergedTarget ---

type MergedTargetData = {
  invocation: TargetInvocationHandle;
  type: string;
  target: unknown;
  profileName?: string;
};

export type MergedTarget = Brand<MergedTargetData, "MergedTarget">;

// --- Stage 6: SubstitutedTarget (Phase 4) ---

export type SubstitutedTarget = Brand<MergedTargetData & { substituted: true }, "SubstitutedTarget">;

// --- Stage 7: ExpandedCall (Phase 4) ---

type ExpandedCallData = MergedTargetData & {
  subcommand: string;
  args: readonly string[];
};

export type ExpandedCall = Brand<ExpandedCallData, "ExpandedCall">;

// --- Stage 8: AuthorizedCall (Phase 5) ---

export type AuthorizedCall = Brand<ExpandedCallData, "AuthorizedCall">;

// --- Stage 9: AuthenticatedCall (Phase 5) ---

export type AuthenticatedCall = Brand<ExpandedCallData & { headers: Record<string, string> }, "AuthenticatedCall">;

// --- Stage 10: ExecutionResult ---

export type ExecutionResult = Brand<{ result: TargetResult }, "ExecutionResult">;

export type { TargetResult };
