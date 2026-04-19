import { homedir } from "os";
import { join } from "path";
import type { Tool } from "../../extension.ts";

const MCP_DIR = join(homedir(), ".clip", "target", "mcp");

function toolsCachePath(targetName: string): string {
  return join(MCP_DIR, targetName, "tools.json");
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
  const dir = join(MCP_DIR, targetName);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(toolsCachePath(targetName), JSON.stringify({ tools }, null, 2));
}
