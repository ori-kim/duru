import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillsStore } from "./store.ts";

export type SkillGroup = {
  name: string;
  description?: string;
  skills: string[];
};

export type SkillGroupUseResult = {
  group: string;
  exported: string[];
  skipped: string[];
};

export type SkillGroupClearResult = {
  group?: string;
  removed: string[];
  skipped: Array<{ name: string; reason: string }>;
};

export type SkillGroupStatusRow = {
  name: string;
  skill: string;
  safe: boolean;
  valid: boolean;
  groups: string;
};

export type SkillGroupStore = {
  list(): Promise<SkillGroup[]>;
  get(name: string): Promise<SkillGroup | null>;
  use(
    name: string,
    targetRoot: string,
    options?: { force?: boolean; mode?: "link" | "copy" },
  ): Promise<SkillGroupUseResult>;
  clear(targetRoot: string, options: { name?: string; all?: boolean }): Promise<SkillGroupClearResult>;
  status(targetRoot: string): Promise<SkillGroupStatusRow[]>;
};

const DURU_PREFIX = "duru-";
const MARKER_FILE = ".duru-skill-link.json";

export function createSkillGroupStore(groupsPath: string, skillsStore: SkillsStore): SkillGroupStore {
  async function list(): Promise<SkillGroup[]> {
    return readGroups(groupsPath);
  }

  async function get(name: string): Promise<SkillGroup | null> {
    return (await list()).find((group) => group.name === name) ?? null;
  }

  async function use(
    name: string,
    targetRoot: string,
    options: { force?: boolean; mode?: "link" | "copy" } = {},
  ): Promise<SkillGroupUseResult> {
    const group = await requireGroup(name);
    const exported: string[] = [];
    const skipped: string[] = [];

    for (const skill of group.skills) {
      const record = await skillsStore.get(skill);
      if (!record) throw new Error(`Group ${group.name} references missing skill: ${skill}`);
      const result = await skillsStore.exportToRoot(targetRoot, {
        name: skill,
        force: options.force,
        mode: options.mode,
        prefix: DURU_PREFIX,
      });
      exported.push(...result.exported);
      skipped.push(...result.skipped);
    }

    return { group: group.name, exported: exported.sort(), skipped: skipped.sort() };
  }

  async function clear(targetRoot: string, options: { name?: string; all?: boolean }): Promise<SkillGroupClearResult> {
    if (options.name && options.all) throw new Error("Pass a group name or --all, not both.");
    if (!options.name && !options.all) throw new Error("Pass a group name or --all.");

    const entries = options.all
      ? await listTargetEntries(targetRoot)
      : (await requireGroup(options.name)).skills.map((skill) => `${DURU_PREFIX}${skill}`);
    const removed: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const entry of entries.filter((entry) => entry.startsWith(DURU_PREFIX)).sort()) {
      const inspection = await inspectTargetEntry(targetRoot, entry, skillsStore.skillsDir);
      if (!inspection.exists) continue;
      if (!inspection.safe) {
        skipped.push({ name: entry, reason: "unsafe" });
        continue;
      }
      await rm(join(targetRoot, entry), { recursive: true, force: true });
      removed.push(inspection.skill);
    }

    return { group: options.name, removed: removed.sort(), skipped };
  }

  async function status(targetRoot: string): Promise<SkillGroupStatusRow[]> {
    const groupMap = await groupsBySkill();
    const rows: SkillGroupStatusRow[] = [];
    for (const entry of await listTargetEntries(targetRoot)) {
      if (!entry.startsWith(DURU_PREFIX)) continue;
      const inspection = await inspectTargetEntry(targetRoot, entry, skillsStore.skillsDir);
      if (!inspection.exists) continue;
      rows.push({
        name: entry,
        skill: inspection.skill,
        safe: inspection.safe,
        valid: inspection.valid,
        groups: (groupMap.get(inspection.skill) ?? []).join(", "),
      });
    }
    return rows.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function requireGroup(name?: string): Promise<SkillGroup> {
    if (!name) throw new Error("Pass a group name.");
    const group = await get(name);
    if (!group) throw new Error(`Group not found: ${name}`);
    return group;
  }

  async function groupsBySkill(): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const group of await list()) {
      for (const skill of group.skills) {
        const names = map.get(skill) ?? [];
        names.push(group.name);
        map.set(skill, names.sort());
      }
    }
    return map;
  }

  return { list, get, use, clear, status };
}

async function readGroups(path: string): Promise<SkillGroup[]> {
  try {
    const parsed = parseYaml(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return [];
    return Object.entries(parsed)
      .flatMap(([name, value]) => {
        const group = parseGroup(name, value);
        return group ? [group] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

function parseGroup(name: string, value: unknown): SkillGroup | null {
  if (Array.isArray(value)) {
    return { name, skills: value.filter((skill): skill is string => typeof skill === "string") };
  }
  if (!isRecord(value) || !Array.isArray(value.skills)) return null;
  return {
    name,
    description: typeof value.description === "string" ? value.description : undefined,
    skills: value.skills.filter((skill): skill is string => typeof skill === "string"),
  };
}

async function listTargetEntries(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function inspectTargetEntry(
  targetRoot: string,
  entryName: string,
  skillsDir: string,
): Promise<{ exists: boolean; skill: string; safe: boolean; valid: boolean }> {
  const entryPath = join(targetRoot, entryName);
  const fallbackSkill = entryName.slice(DURU_PREFIX.length);
  try {
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) {
      const target = await symlinkTarget(entryPath);
      const safe = isWithin(skillsDir, target);
      return { exists: true, skill: fallbackSkill, safe, valid: safe && (await hasSkillFile(entryPath)) };
    }
    if (info.isDirectory()) {
      const marker = await readMarker(entryPath);
      return {
        exists: true,
        skill: marker?.name ?? fallbackSkill,
        safe: marker !== null,
        valid: marker !== null && (await hasSkillFile(entryPath)),
      };
    }
    return { exists: true, skill: fallbackSkill, safe: false, valid: false };
  } catch (error) {
    if (isNotFoundError(error)) return { exists: false, skill: fallbackSkill, safe: false, valid: false };
    throw error;
  }
}

async function symlinkTarget(path: string): Promise<string> {
  const target = await readlink(path);
  return resolve(dirname(path), target);
}

async function readMarker(dir: string): Promise<{ name: string; source?: string } | null> {
  try {
    const marker = JSON.parse(await readFile(join(dir, MARKER_FILE), "utf8")) as { name?: unknown; source?: unknown };
    if (typeof marker.name !== "string") return null;
    return { name: marker.name, source: typeof marker.source === "string" ? marker.source : undefined };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function hasSkillFile(dir: string): Promise<boolean> {
  try {
    await lstat(join(dir, "SKILL.md"));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isWithin(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
