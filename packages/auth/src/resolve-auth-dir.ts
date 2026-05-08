import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = process.env.CLIP_HOME ?? join(homedir(), ".clip");

export function resolveAuthDir(targetName: string, type: string): string {
  return join(CONFIG_DIR, "target", type, targetName);
}
