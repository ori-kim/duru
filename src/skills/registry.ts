import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { CONFIG_DIR, WORKSPACE_ROOT, getActiveWorkspace } from "../config.ts";
import { parseSkillFile } from "./frontmatter.ts";
import type { SkillFrontmatter } from "./frontmatter.ts";

const SKILLS_SUBDIR = "skills";

export const RESERVED_SKILL_NAMES = new Set(["add", "list", "show", "get", "rm"]);

export type SkillScope = "global" | "workspace";

export type SkillEntry = {
  name: string;
  dir: string;
  scope: SkillScope;
  fm: SkillFrontmatter;
  body: string;
};

// global first (low priority), workspace last (overrides)
export function getSkillDirs(): { dir: string; scope: SkillScope }[] {
  const dirs: { dir: string; scope: SkillScope }[] = [
    { dir: join(CONFIG_DIR, SKILLS_SUBDIR), scope: "global" },
  ];
  const ws = getActiveWorkspace();
  if (ws) {
    dirs.push({ dir: join(WORKSPACE_ROOT, ws, SKILLS_SUBDIR), scope: "workspace" });
  }
  return dirs;
}

// workspace-first lookup (highest priority first)
export function findSkillDir(name: string): { dir: string; scope: SkillScope } | null {
  const dirs = [...getSkillDirs()].reverse();
  for (const { dir, scope } of dirs) {
    const skillDir = join(dir, name);
    if (existsSync(join(skillDir, "SKILL.md"))) return { dir: skillDir, scope };
  }
  return null;
}

export function loadAllSkills(): SkillEntry[] {
  const seen = new Map<string, SkillEntry>();
  // load global first, then workspace — workspace overrides global
  for (const { dir, scope } of getSkillDirs()) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of entries) {
      const skillDir = join(dir, name);
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        const raw = readFileSync(skillFile, "utf8");
        const { fm, body } = parseSkillFile(raw, skillFile);
        seen.set(name, { name, dir: skillDir, scope, fm, body });
      } catch {
        // parse errors are surfaced in loadAllSkillsSafe
      }
    }
  }
  return [...seen.values()];
}

export function loadAllSkillsSafe(): { entries: SkillEntry[]; errors: { file: string; message: string }[] } {
  const seen = new Map<string, SkillEntry>();
  const errors: { file: string; message: string }[] = [];

  for (const { dir, scope } of getSkillDirs()) {
    if (!existsSync(dir)) continue;
    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of dirEntries) {
      const skillDir = join(dir, name);
      const skillFile = join(skillDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        const rawSync = readFileSync(skillFile, "utf8");
        const { fm, body } = parseSkillFile(rawSync, skillFile);
        seen.set(name, { name, dir: skillDir, scope, fm, body });
      } catch (e: unknown) {
        errors.push({ file: skillFile, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return { entries: [...seen.values()], errors };
}

export async function writeSkill(name: string, scope: SkillScope, content: string): Promise<void> {
  const dirs = getSkillDirs();
  const target = scope === "workspace" ? dirs[dirs.length - 1] : dirs[0];
  if (!target) throw new Error(`No directory for scope: ${scope}`);
  const skillDir = join(target.dir, name);
  mkdirSync(skillDir, { recursive: true });
  await Bun.write(join(skillDir, "SKILL.md"), content);
}

export function removeSkill(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
