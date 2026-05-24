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
    if (!match) return {};

    const yaml = match[1];
    const result: Partial<SkillMeta> = {};

    for (const line of yaml.split(/\r?\n/)) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();

      if (!key) continue;

      if (key === "tags") {
        // YAML 인라인 배열: [a, b, c] 또는 빈값
        if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
          const inner = rawValue.slice(1, -1);
          result.tags = inner
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (rawValue === "") {
          result.tags = [];
        } else {
          result.tags = [rawValue];
        }
      } else if (key === "allowedTools") {
        if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
          const inner = rawValue.slice(1, -1);
          result.allowedTools = inner
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (rawValue !== "") {
          result.allowedTools = [rawValue];
        }
      } else if (key === "name") {
        result.name = rawValue;
      } else if (key === "description") {
        result.description = rawValue;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function createSkillsStore(files: FileStore): SkillsStore {
  const skillsDir = files.root;

  async function list(): Promise<SkillRecord[]> {
    const entries = await files.list();
    const records: SkillRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      const skillPath = join(skillsDir, entry.name, "SKILL.md");
      const content = await files.scope(entry.name).readText("SKILL.md");
      if (!content) continue;

      const meta = parseFrontmatter(content);
      if (!meta.name || !meta.description) continue;

      records.push({
        meta: {
          name: meta.name,
          description: meta.description,
          tags: meta.tags ?? [],
          allowedTools: meta.allowedTools,
        },
        dir: join(skillsDir, entry.name),
        skillPath,
      });
    }

    return records;
  }

  async function get(name: string): Promise<SkillRecord | null> {
    const records = await list();
    return records.find((r) => r.meta.name === name) ?? null;
  }

  async function add(srcPath: string): Promise<SkillRecord> {
    // srcPath가 SKILL.md 파일이면 부모 디렉터리 사용
    let srcDir: string;
    if (basename(srcPath) === "SKILL.md") {
      srcDir = dirname(srcPath);
    } else {
      srcDir = srcPath;
    }

    // SKILL.md에서 name 읽기
    const skillMdPath = join(srcDir, "SKILL.md");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(skillMdPath, "utf8");
    const meta = parseFrontmatter(content);

    if (!meta.name) {
      throw new Error(`SKILL.md at ${skillMdPath} is missing required 'name' field in frontmatter`);
    }
    if (!meta.description) {
      throw new Error(`SKILL.md at ${skillMdPath} is missing required 'description' field in frontmatter`);
    }

    const destDir = join(skillsDir, meta.name);

    // 기존 디렉터리가 있으면 먼저 삭제 (덮어쓰기)
    await rm(destDir, { recursive: true, force: true });

    // 디렉터리 전체 복사
    await cp(srcDir, destDir, { recursive: true });

    const skillPath = join(destDir, "SKILL.md");
    return {
      meta: {
        name: meta.name,
        description: meta.description,
        tags: meta.tags ?? [],
        allowedTools: meta.allowedTools,
      },
      dir: destDir,
      skillPath,
    };
  }

  async function del(name: string): Promise<void> {
    const destDir = join(skillsDir, name);
    await rm(destDir, { recursive: true, force: true });
  }

  return {
    list,
    get,
    add,
    delete: del,
    skillsDir,
  };
}
