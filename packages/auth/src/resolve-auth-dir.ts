import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = process.env.CLIP_HOME ?? join(homedir(), ".clip");

export function resolveAuthDir(targetName: string, type: string): string {
  return join(CONFIG_DIR, "target", type, targetName);
}
