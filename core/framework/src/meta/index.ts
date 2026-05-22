import type { CommandConfig, CommandMetadata } from "../types/index.ts";

export function meta(metadata: CommandMetadata): CommandConfig {
  return { ...metadata };
}
