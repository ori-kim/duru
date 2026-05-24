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

// 실제로 존재하는 에이전트 폴더만 반환
export async function detectAgents(): Promise<AgentName[]> {
  const agents: AgentName[] = ["claude", "gemini", "codex"];
  const detected: AgentName[] = [];

  for (const agent of agents) {
    const agentDir = AGENT_SKILL_DIRS[agent];
    try {
      const s = await stat(agentDir);
      if (s.isDirectory()) {
        detected.push(agent);
      }
    } catch {
      // 폴더 없으면 skip
    }
  }

  return detected;
}

// 에이전트 skills dir → DURU_HOME/skills (store.skillsDir)
export async function importFromAgent(
  agent: AgentName,
  skillName: string | undefined,
  store: SkillsStore,
): Promise<{ imported: string[]; skipped: string[] }> {
  const agentDir = AGENT_SKILL_DIRS[agent];
  const imported: string[] = [];
  const skipped: string[] = [];

  // 에이전트 디렉터리 없으면 즉시 반환
  try {
    const s = await stat(agentDir);
    if (!s.isDirectory()) {
      return { imported, skipped };
    }
  } catch {
    return { imported, skipped };
  }

  // 에이전트 디렉터리의 하위 디렉터리 순회
  const entries = await readdir(agentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;

    // skillName 지정 시 해당 이름만 처리
    if (skillName !== undefined && name !== skillName) continue;

    const agentSkillDir = join(agentDir, name);
    const skillMdPath = join(agentSkillDir, "SKILL.md");

    // SKILL.md 있는지 확인
    try {
      await stat(skillMdPath);
    } catch {
      skipped.push(name);
      continue;
    }

    // DURU_HOME/skills/<name> 으로 복사
    const destDir = join(store.skillsDir, name);
    await cp(agentSkillDir, destDir, { recursive: true });
    imported.push(name);
  }

  return { imported, skipped };
}

// DURU_HOME/skills (store.skillsDir) → 에이전트 skills dir
export async function exportToAgent(
  agent: AgentName,
  skillName: string | undefined,
  store: SkillsStore,
): Promise<{ exported: string[]; skipped: string[] }> {
  const agentDir = AGENT_SKILL_DIRS[agent];
  const exported: string[] = [];
  const skipped: string[] = [];

  // 에이전트 루트 디렉터리 없으면 생성
  await mkdir(agentDir, { recursive: true });

  // 스킬 목록 가져오기
  let records = await store.list();

  // skillName 지정 시 해당 스킬만
  if (skillName !== undefined) {
    records = records.filter((r) => r.meta.name === skillName);
  }

  for (const record of records) {
    const name = record.meta.name;
    const destSkillDir = join(agentDir, name);

    // 에이전트 스킬 폴더 없으면 생성 후 복사
    await mkdir(destSkillDir, { recursive: true });
    await cp(record.dir, destSkillDir, { recursive: true });
    exported.push(name);
  }

  return { exported, skipped };
}
