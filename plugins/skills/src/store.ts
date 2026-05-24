import { cp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FileStore } from "@duru/file-store";
import type { SkillMeta, SkillRecord } from "./types.ts";

export type SkillsStore = {
  list(): Promise<SkillRecord[]>;
  get(name: string): Promise<SkillRecord | null>;
  add(srcPath: string): Promise<SkillRecord>;
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
      result.tags = inner.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      result.tags = [rawValue];
    }
  } else if (key === "allowed-tools" || key === "allowedTools") {
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1);
      result.allowedTools = inner.split(",").map((s) => s.trim()).filter(Boolean);
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
      if (!entry.isDirectory) continue;
      const content = await files.scope(entry.name).readText("SKILL.md");
      if (!content) continue;
      const meta = parseFrontmatter(content);
      if (!meta.name) continue;
      records.push({
        meta: { name: meta.name, description: meta.description, tags: meta.tags ?? [], allowedTools: meta.allowedTools },
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
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(skillMdPath, "utf8");
    const meta = parseFrontmatter(content);
    if (!meta.name) {
      throw new Error(`SKILL.md at ${skillMdPath} is missing required 'name' field in frontmatter`);
    }
    const destDir = join(skillsDir, meta.name);
    await rm(destDir, { recursive: true, force: true });
    await cp(srcDir, destDir, { recursive: true });
    return {
      meta: { name: meta.name, description: meta.description, tags: meta.tags ?? [], allowedTools: meta.allowedTools } satisfies SkillMeta,
      dir: destDir,
      skillPath: join(destDir, "SKILL.md"),
    };
  }

  async function del(name: string): Promise<void> {
    await rm(join(skillsDir, name), { recursive: true, force: true });
  }

  return { list, get, add, delete: del, skillsDir };
}
