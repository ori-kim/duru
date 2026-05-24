import { homedir } from "node:os";
import { join } from "node:path";
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import type { SkillsStore } from "./store.ts";

export type AgentName = "claude" | "gemini" | "codex";

export const AGENT_SKILL_DIRS: Record<AgentName, string> = {
  claude: join(homedir(), ".claude", "skills"),
  gemini: join(homedir(), ".gemini", "skills"),
  codex:  join(homedir(), ".codex",  "skills"),
};

export async function detectAgents(): Promise<AgentName[]> {
  const agents: AgentName[] = ["claude", "gemini", "codex"];
  const detected: AgentName[] = [];
  for (const agent of agents) {
    try {
      const s = await stat(AGENT_SKILL_DIRS[agent]);
      if (s.isDirectory()) detected.push(agent);
    } catch {}
  }
  return detected;
}

export async function importFromAgent(
  agent: AgentName,
  skillName: string | undefined,
  store: SkillsStore,
): Promise<{ imported: string[]; skipped: string[] }> {
  const agentDir = AGENT_SKILL_DIRS[agent];
  const imported: string[] = [];
  const skipped: string[] = [];

  try {
    const s = await stat(agentDir);
    if (!s.isDirectory()) return { imported, skipped };
  } catch {
    return { imported, skipped };
  }

  const entries = await readdir(agentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (skillName !== undefined && name !== skillName) continue;
    const agentSkillDir = join(agentDir, name);
    try {
      await store.add(agentSkillDir);
      imported.push(name);
    } catch {
      skipped.push(name);
    }
  }

  return { imported, skipped };
}

export async function exportToAgent(
  agent: AgentName,
  skillName: string | undefined,
  store: SkillsStore,
): Promise<{ exported: string[]; skipped: string[] }> {
  const agentDir = AGENT_SKILL_DIRS[agent];
  const exported: string[] = [];
  const skipped: string[] = [];

  await mkdir(agentDir, { recursive: true });

  let records = await store.list();
  if (skillName !== undefined) {
    records = records.filter((r) => r.meta.name === skillName);
  }

  for (const record of records) {
    const destSkillDir = join(agentDir, record.meta.name);
    try {
      await mkdir(destSkillDir, { recursive: true });
      await cp(record.dir, destSkillDir, { recursive: true });
      exported.push(record.meta.name);
    } catch {
      skipped.push(record.meta.name);
    }
  }

  return { exported, skipped };
}
