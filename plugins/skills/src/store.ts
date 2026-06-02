import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FileStore } from "@duru/file-store";
import type { SkillMeta, SkillRecord } from "./types.ts";

export type SkillTransferOptions = {
  name?: string;
  all?: boolean;
  force?: boolean;
  mode?: "link" | "copy";
  prefix?: string;
};

export type SkillImportResult = {
  imported: string[];
  skipped: string[];
};

export type SkillExportResult = {
  exported: string[];
  skipped: string[];
};

const DEFAULT_EXPORT_PREFIX = "duru-";
const SKILL_MARKER_FILE = ".duru-skill-link.json";

export type SkillsStore = {
  list(): Promise<SkillRecord[]>;
  get(name: string): Promise<SkillRecord | null>;
  add(srcPath: string): Promise<SkillRecord>;
  importFromRoot(rootPath: string, options: SkillTransferOptions): Promise<SkillImportResult>;
  exportToRoot(rootPath: string, options: SkillTransferOptions): Promise<SkillExportResult>;
  delete(name: string): Promise<void>;
  skillsDir: string;
};

function parseFrontmatter(content: string): Partial<SkillMeta> {
  try {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match || !match[1]) return {};

    const result: Partial<SkillMeta> = {};
    const lines = match[1].split(/\r?\n/);
    let pendingKey: string | null = null;
    let multilineLines: string[] = [];

    function flushMultiline() {
      if (!pendingKey || multilineLines.length === 0) {
        pendingKey = null;
        multilineLines = [];
        return;
      }
      applyValue(result, pendingKey, multilineLines.join(" "));
      pendingKey = null;
      multilineLines = [];
    }

    for (const line of [...lines, ""]) {
      const isIndented = /^\s+\S/.test(line);
      if (pendingKey) {
        if (isIndented || line.trim() === "") {
          if (line.trim()) multilineLines.push(line.trim());
          continue;
        }
        flushMultiline();
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();
      if (!key) continue;

      if (rawValue === "") {
        pendingKey = key;
      } else {
        applyValue(result, key, rawValue);
      }
    }

    return result;
  } catch {
    return {};
  }
}

function applyValue(result: Partial<SkillMeta>, key: string, rawValue: string) {
  if (key === "name") {
    result.name = rawValue;
  } else if (key === "description") {
    result.description = rawValue;
  } else if (key === "tags") {
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1);
      result.tags = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      result.tags = [rawValue];
    }
  } else if (key === "allowed-tools" || key === "allowedTools") {
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1);
      result.allowedTools = inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      result.allowedTools = [rawValue];
    }
  }
}

export function createSkillsStore(files: FileStore): SkillsStore {
  const skillsDir = files.root;

  async function list(): Promise<SkillRecord[]> {
    const entries = await files.list();
    const records: SkillRecord[] = [];
    for (const entry of entries) {
      const content = await files.scope(entry.name).readText("SKILL.md");
      if (!content) continue;
      const meta = parseFrontmatter(content);
      if (!meta.name) continue;
      records.push({
        meta: {
          name: meta.name,
          description: meta.description,
          tags: meta.tags ?? [],
          allowedTools: meta.allowedTools,
        },
        dir: join(skillsDir, entry.name),
        skillPath: join(skillsDir, entry.name, "SKILL.md"),
      });
    }
    return records;
  }

  async function get(name: string): Promise<SkillRecord | null> {
    return (await list()).find((r) => r.meta.name === name) ?? null;
  }

  async function add(srcPath: string): Promise<SkillRecord> {
    const srcDir = basename(srcPath) === "SKILL.md" ? dirname(srcPath) : srcPath;
    const skillMdPath = join(srcDir, "SKILL.md");
    const content = await readFile(skillMdPath, "utf8");
    const meta = parseFrontmatter(content);
    if (!meta.name) {
      throw new Error(`SKILL.md at ${skillMdPath} is missing required 'name' field in frontmatter`);
    }
    const destDir = join(skillsDir, meta.name);
    await rm(destDir, { recursive: true, force: true });
    await cp(srcDir, destDir, { recursive: true });
    return {
      meta: {
        name: meta.name,
        description: meta.description,
        tags: meta.tags ?? [],
        allowedTools: meta.allowedTools,
      } satisfies SkillMeta,
      dir: destDir,
      skillPath: join(destDir, "SKILL.md"),
    };
  }

  async function importFromRoot(rootPath: string, options: SkillTransferOptions): Promise<SkillImportResult> {
    const sourceDirs = await sourceSkillDirs(rootPath, options);
    const imported: string[] = [];
    const skipped: string[] = [];

    for (const sourceDir of sourceDirs) {
      const record = await readSkillRecordFromDir(sourceDir);
      const destDir = join(skillsDir, record.meta.name);
      if (await exists(destDir)) {
        if (!options.force) {
          throw new Error(`Skill already exists: ${record.meta.name}. Use --force to replace it.`);
        }
        await rm(destDir, { recursive: true, force: true });
      }
      await transferSkill(sourceDir, destDir, { ...options, prefix: "" }, record.meta.name);
      imported.push(record.meta.name);
    }

    return { imported: imported.sort(), skipped };
  }

  async function exportToRoot(rootPath: string, options: SkillTransferOptions): Promise<SkillExportResult> {
    const records = await selectedRecords(options);
    const exported: string[] = [];
    const skipped: string[] = [];

    await mkdir(rootPath, { recursive: true });
    for (const record of records) {
      const prefix = options.prefix ?? DEFAULT_EXPORT_PREFIX;
      const destDir = join(rootPath, `${prefix}${record.meta.name}`);
      if (await exists(destDir)) {
        if (!options.force) {
          throw new Error(`Skill already exists at destination: ${record.meta.name}. Use --force to replace it.`);
        }
        await rm(destDir, { recursive: true, force: true });
      }
      await transferSkill(record.dir, destDir, options, record.meta.name);
      exported.push(record.meta.name);
    }

    return { exported: exported.sort(), skipped };
  }

  async function selectedRecords(options: SkillTransferOptions): Promise<SkillRecord[]> {
    if (options.all) return list();
    if (!options.name) throw new Error("Pass a skill name or --all.");
    const record = await get(options.name);
    if (!record) throw new Error(`Skill not found: ${options.name}`);
    return [record];
  }

  async function del(name: string): Promise<void> {
    await rm(join(skillsDir, name), { recursive: true, force: true });
  }

  return { list, get, add, importFromRoot, exportToRoot, delete: del, skillsDir };
}

async function sourceSkillDirs(rootPath: string, options: SkillTransferOptions): Promise<string[]> {
  if (options.all) {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      const dir = join(rootPath, entry.name);
      if (await hasSkillMarkdown(dir)) dirs.push(dir);
    }
    return dirs.sort();
  }
  if (!options.name) throw new Error("Pass a skill name or --all.");
  const direct = join(rootPath, options.name);
  if (await exists(direct)) return [direct];
  const prefixed = join(rootPath, `${options.prefix ?? DEFAULT_EXPORT_PREFIX}${options.name}`);
  if (await exists(prefixed)) return [prefixed];
  return [direct];
}

async function readSkillRecordFromDir(dir: string): Promise<SkillRecord> {
  const skillPath = join(dir, "SKILL.md");
  const content = await readFile(skillPath, "utf8");
  const meta = parseFrontmatter(content);
  if (!meta.name) {
    throw new Error(`SKILL.md at ${skillPath} is missing required 'name' field in frontmatter`);
  }
  return {
    meta: { name: meta.name, description: meta.description, tags: meta.tags ?? [], allowedTools: meta.allowedTools },
    dir,
    skillPath,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") return false;
    throw err;
  }
}

async function hasSkillMarkdown(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, "SKILL.md"), "utf8");
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") return false;
    throw err;
  }
}

async function transferSkill(
  sourceDir: string,
  destDir: string,
  options: Pick<SkillTransferOptions, "mode">,
  name: string,
): Promise<void> {
  if (options.mode === "copy") {
    await cp(sourceDir, destDir, { recursive: true, dereference: true });
    await writeFile(join(destDir, SKILL_MARKER_FILE), JSON.stringify({ name, source: sourceDir }), "utf8");
    return;
  }
  await mkdir(dirname(destDir), { recursive: true });
  await symlink(sourceDir, destDir, "dir");
}
