import { type HasProfiles, resolveProfile } from "../commands/profile.ts";
import type { Registry } from "@clip/core";
import type { BoundTarget, MergedTarget, TargetInvocationHandle } from "./types.ts";

const BUILTIN_TYPES = new Set(["cli", "mcp", "api", "grpc", "graphql", "script"]);

type BoundData = {
  invocation: TargetInvocationHandle;
  type: string;
  rawTarget: unknown;
  configDir: string;
};

type MergedData = {
  invocation: TargetInvocationHandle;
  type: string;
  target: unknown;
  profileName: string | undefined;
};

export function resolveProfileStage(bound: BoundTarget, registry: Registry): MergedTarget {
  const b = bound as unknown as BoundData;
  const { invocation, type, rawTarget } = b;

  const { merged, profileName } = resolveProfile(rawTarget as HasProfiles, invocation.explicitProfile);

  // extension target에 대해 profile 적용 후 full schema 검증
  if (!BUILTIN_TYPES.has(type)) {
    const def = registry.getTargetType(type);
    if (def) {
      const result = def.schema.safeParse(merged);
      if (!result.success) {
        throw new Error(`${invocation.baseName}: invalid config after profile merge: ${result.error.message}`);
      }
    }
  }

  const data: MergedData = {
    invocation,
    type,
    target: merged,
    profileName,
  };

  return data as unknown as MergedTarget;
}
