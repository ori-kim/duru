import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".clip");
const WORKSPACE_FILE = join(CONFIG_DIR, ".workspace");
const WORKSPACE_ROOT = join(CONFIG_DIR, "workspace");

function getActiveWorkspace(): string | null {
  try {
    const content = readFileSync(WORKSPACE_FILE, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

function findTargetConfigDir(name: string, type: string): string | null {
  const ws = getActiveWorkspace();
  const dirs: string[] = [join(CONFIG_DIR, "target")];
  if (ws) dirs.push(join(WORKSPACE_ROOT, ws, "target"));
  // workspace-first lookup (reverse order)
  for (const dir of [...dirs].reverse()) {
    const targetDir = join(dir, type, name);
    if (existsSync(join(targetDir, "config.yml"))) return targetDir;
  }
  return null;
}

/**
 * targetName + type으로 auth 디렉터리 경로를 계산한다.
 * config.ts 의존 없이 직접 구현해 순환 의존을 방지한다.
 */
export function resolveAuthDir(targetName: string, type: string): string {
  return findTargetConfigDir(targetName, type) ?? join(CONFIG_DIR, "target", type, targetName);
}
