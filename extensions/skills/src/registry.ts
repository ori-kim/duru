import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { parse as yamlParse, stringify as dumpYAML } from "yaml";
import { CONFIG_DIR } from "@clip/core";
import { parseSkillFile } from "./frontmatter.ts";
import type { SkillFrontmatter } from "./frontmatter.ts";

// ─── Groups ───

const GROUPS_FILE = join(CONFIG_DIR, "skills", "groups.yml");

export type GroupDef = {
  skills: string[];
  description?: string;
};

type GroupsFile = { groups: Record<string, GroupDef> };

function loadGroupsFile(): GroupsFile {
  try {
    const parsed = yamlParse(readFileSync(GROUPS_FILE, "utf8")) as GroupsFile | null;
    if (!parsed || typeof parsed.groups !== "object") return { groups: {} };
    return parsed;
  } catch {
    return { groups: {} };
  }
}

function saveGroupsFile(data: GroupsFile): void {
  mkdirSync(join(CONFIG_DIR, "skills"), { recursive: true });
  Bun.write(GROUPS_FILE, dumpYAML(data));
}

export function listGroupNames(): string[] {
  return Object.keys(loadGroupsFile().groups).sort();
}

export function loadGroup(name: string): GroupDef | null {
  return loadGroupsFile().groups[name] ?? null;
}

export function saveGroup(name: string, def: GroupDef): void {
  const data = loadGroupsFile();
  data.groups[name] = def;
  saveGroupsFile(data);
}

export function deleteGroup(name: string): boolean {
  const data = loadGroupsFile();
  if (!(name in data.groups)) return false;
  delete data.groups[name];
  saveGroupsFile(data);
  return true;
}

const SKILLS_DIR = join(CONFIG_DIR, "skills");

export const RESERVED_SKILL_NAMES = new Set(["add", "list", "show", "get", "rm"]);

export type SkillEntry = {
  name: string;
  dir: string;
  fm: SkillFrontmatter;
  body: string;
};

export function getSkillsDir(): string {
  return SKILLS_DIR;
}

export function findSkillDir(name: string): string | null {
  const skillDir = join(SKILLS_DIR, name);
  if (existsSync(join(skillDir, "SKILL.md"))) return skillDir;
  return null;
}

export function loadAllSkills(): SkillEntry[] {
  if (!existsSync(SKILLS_DIR)) return [];
  let entries: string[];
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const result: SkillEntry[] = [];
  for (const name of entries) {
    const skillDir = join(SKILLS_DIR, name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const raw = readFileSync(skillFile, "utf8");
      const { fm, body } = parseSkillFile(raw, skillFile);
      result.push({ name, dir: skillDir, fm, body });
    } catch {
      // parse errors surfaced in loadAllSkillsSafe
    }
  }
  return result;
}

export function loadAllSkillsSafe(): { entries: SkillEntry[]; errors: { file: string; message: string }[] } {
  const entries: SkillEntry[] = [];
  const errors: { file: string; message: string }[] = [];
  if (!existsSync(SKILLS_DIR)) return { entries, errors };
  let dirEntries: string[];
  try {
    dirEntries = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { entries, errors };
  }
  for (const name of dirEntries) {
    const skillDir = join(SKILLS_DIR, name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const raw = readFileSync(skillFile, "utf8");
      const { fm, body } = parseSkillFile(raw, skillFile);
      entries.push({ name, dir: skillDir, fm, body });
    } catch (e: unknown) {
      errors.push({ file: skillFile, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { entries, errors };
}

export async function writeSkill(name: string, content: string): Promise<void> {
  const skillDir = join(SKILLS_DIR, name);
  mkdirSync(skillDir, { recursive: true });
  await Bun.write(join(skillDir, "SKILL.md"), content);
}

export function removeSkill(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
