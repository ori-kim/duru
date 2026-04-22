import type {
  LateFlags,
  MatchedCommand,
  ParsedInvocation,
  TargetInvocationHandle,
} from "./types.ts";

type ParsedData = {
  token: string | undefined;
  baseName: string | undefined;
  explicitProfile: string | undefined;
  userArgs: readonly string[];
  lateFlags: LateFlags;
  internalVerb: string | undefined;
};

export function matchCommand(parsed: ParsedInvocation): MatchedCommand {
  const p = parsed as unknown as ParsedData;

  // top-level --help (version은 clip.ts에서 처리)
  if (p.internalVerb === "help") {
    return { kind: "help", what: "top" as const } as unknown as MatchedCommand;
  }

  // internal verb
  if (p.internalVerb && p.internalVerb !== "version") {
    return {
      kind: "internal",
      verb: p.internalVerb,
      rest: p.userArgs,
    } as unknown as MatchedCommand;
  }

  if (!p.token) {
    return { kind: "help", what: "top" as const } as unknown as MatchedCommand;
  }
  if (!p.baseName) {
    throw new Error(`Invalid target: "${p.token}". Format: clip <target>[@<profile>] <tool> [args]`);
  }

  // target invocation: --help <tool> 재배치
  const userArgs = [...p.userArgs];
  let subcommand: string | undefined = userArgs[0];
  let targetArgs: string[] = userArgs.slice(1);

  if (
    (subcommand === "--help" || subcommand === "-h") &&
    targetArgs.length > 0 &&
    !targetArgs[0]!.startsWith("-")
  ) {
    const toolName = targetArgs[0]!;
    targetArgs = ["--help", ...targetArgs.slice(1)];
    subcommand = toolName;
  }

  const invocation: TargetInvocationHandle = {
    baseName: p.baseName,
    explicitProfile: p.explicitProfile,
    token: p.token,
    userArgs: p.userArgs,
    lateFlags: p.lateFlags,
    subcommand,
    targetArgs: Object.freeze(targetArgs) as readonly string[],
  };

  return { kind: "target", invocation } as unknown as MatchedCommand;
}
