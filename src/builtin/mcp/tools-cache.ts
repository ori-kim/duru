import { join } from "path";
import { CONFIG_DIR, findTargetConfigDir } from "../../config.ts";
import type { Tool } from "../../extension.ts";

function toolsCachePath(targetName: string): string {
  const dir = findTargetConfigDir(targetName, "mcp") ?? join(CONFIG_DIR, "target", "mcp", targetName);
  return join(dir, "tools.json");
}

export async function readToolsCache(targetName: string): Promise<Tool[] | null> {
  const path = toolsCachePath(targetName);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const raw = JSON.parse(await file.text()) as { tools: Tool[] };
    return Array.isArray(raw.tools) ? raw.tools : null;
  } catch {
    return null;
  }
}

export async function writeToolsCache(targetName: string, tools: Tool[]): Promise<void> {
  const cachePath = toolsCachePath(targetName);
  const dir = join(cachePath, "..");
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(cachePath, JSON.stringify({ tools }, null, 2));
}
