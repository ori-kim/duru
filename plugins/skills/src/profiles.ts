import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillsStore } from "./store.ts";

export type SkillProfile = {
  name: string;
  skills: string[];
};

export type SkillProfileUseResult = {
  profile: string;
  exported: string[];
  skipped: string[];
};

export type SkillProfileClearResult = {
  profile?: string;
  removed: string[];
  skipped: Array<{ name: string; reason: string }>;
};

export type SkillProfileStatusRow = {
  name: string;
  skill: string;
  safe: boolean;
  valid: boolean;
  profiles: string;
};

export type SkillProfileStore = {
  list(): Promise<SkillProfile[]>;
  get(name: string): Promise<SkillProfile | null>;
  use(
    name: string,
    targetRoot: string,
    options?: { force?: boolean; mode?: "link" | "copy" },
  ): Promise<SkillProfileUseResult>;
  clear(targetRoot: string, options: { name?: string; all?: boolean }): Promise<SkillProfileClearResult>;
  status(targetRoot: string): Promise<SkillProfileStatusRow[]>;
};

const DURU_PREFIX = "duru-";
const MARKER_FILE = ".duru-skill-link.json";

export function createSkillProfileStore(profileRoot: string, skillsStore: SkillsStore): SkillProfileStore {
  async function list(): Promise<SkillProfile[]> {
    const entries = await listProfileEntries(profileRoot);
    const profiles: SkillProfile[] = [];
    for (const entry of entries) {
      const profile = await readProfile(join(profileRoot, entry));
      if (profile) profiles.push(profile);
    }
    return profiles.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function get(name: string): Promise<SkillProfile | null> {
    return (await list()).find((profile) => profile.name === name) ?? null;
  }

  async function use(
    name: string,
    targetRoot: string,
    options: { force?: boolean; mode?: "link" | "copy" } = {},
  ): Promise<SkillProfileUseResult> {
    const profile = await requireProfile(name);
    const exported: string[] = [];
    const skipped: string[] = [];

    for (const skill of profile.skills) {
      const record = await skillsStore.get(skill);
      if (!record) throw new Error(`Profile ${profile.name} references missing skill: ${skill}`);
      const result = await skillsStore.exportToRoot(targetRoot, {
        name: skill,
        force: options.force,
        mode: options.mode,
        prefix: DURU_PREFIX,
      });
      exported.push(...result.exported);
      skipped.push(...result.skipped);
    }

    return { profile: profile.name, exported: exported.sort(), skipped: skipped.sort() };
  }

  async function clear(
    targetRoot: string,
    options: { name?: string; all?: boolean },
  ): Promise<SkillProfileClearResult> {
    if (options.name && options.all) throw new Error("Pass a profile name or --all, not both.");
    if (!options.name && !options.all) throw new Error("Pass a profile name or --all.");

    const entries = options.all
      ? await listTargetEntries(targetRoot)
      : (await requireProfile(options.name)).skills.map((skill) => `${DURU_PREFIX}${skill}`);
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

    return { profile: options.name, removed: removed.sort(), skipped };
  }

  async function status(targetRoot: string): Promise<SkillProfileStatusRow[]> {
    const profileMap = await profilesBySkill();
    const rows: SkillProfileStatusRow[] = [];
    for (const entry of await listTargetEntries(targetRoot)) {
      if (!entry.startsWith(DURU_PREFIX)) continue;
      const inspection = await inspectTargetEntry(targetRoot, entry, skillsStore.skillsDir);
      if (!inspection.exists) continue;
      rows.push({
        name: entry,
        skill: inspection.skill,
        safe: inspection.safe,
        valid: inspection.valid,
        profiles: (profileMap.get(inspection.skill) ?? []).join(", "),
      });
    }
    return rows.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function requireProfile(name?: string): Promise<SkillProfile> {
    if (!name) throw new Error("Pass a profile name.");
    const profile = await get(name);
    if (!profile) throw new Error(`Profile not found: ${name}`);
    return profile;
  }

  async function profilesBySkill(): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const profile of await list()) {
      for (const skill of profile.skills) {
        const names = map.get(skill) ?? [];
        names.push(profile.name);
        map.set(skill, names.sort());
      }
    }
    return map;
  }

  return { list, get, use, clear, status };
}

async function listProfileEntries(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function readProfile(path: string): Promise<SkillProfile | null> {
  const raw = await readFile(path, "utf8");
  const parsed = parseYaml(raw) as { name?: unknown; skills?: unknown } | null;
  if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.skills)) return null;
  const skills = parsed.skills.filter((skill): skill is string => typeof skill === "string");
  return { name: parsed.name, skills };
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

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
