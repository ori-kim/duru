import { join } from "path";
import { CONFIG_DIR, type Config, getTarget } from "../config.ts";
import type { Registry } from "../extension.ts";
import type { BoundTarget, TargetInvocationHandle } from "./types.ts";

type BoundData = {
  invocation: TargetInvocationHandle;
  type: string;
  rawTarget: unknown;
  configDir: string;
};

export function bindTarget(invocation: TargetInvocationHandle, config: Config, registry: Registry): BoundTarget {
  const { baseName } = invocation;

  // target 존재 확인 — 없으면 getTarget이 die() 호출
  const resolved = getTarget(config, baseName);
  const { type, target: rawTarget } = resolved;

  // type이 registry에 등록된지 확인
  const def = registry.getTargetType(type);
  if (!def) throw new Error(`Unknown target type: "${type}"`);

  const configDir = config._configDirs?.[baseName] ?? join(CONFIG_DIR, "target", type, baseName);

  const data: BoundData = {
    invocation,
    type,
    rawTarget,
    configDir,
  };

  return data as unknown as BoundTarget;
}
