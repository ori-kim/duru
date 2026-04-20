import type { TargetTypeDef } from "../../extension.ts";

export type SubstPathSpec = {
  substPaths?: string[];
  substRecordPaths?: string[];
};

// Phase 4에서 본격 구현
export function getSubstPaths(_typeDef: TargetTypeDef): SubstPathSpec {
  return {};
}
