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

    const yaml = match[1];
    const result: Partial<SkillMeta> = {};
    const lines = yaml.split(/\r?\n/);

    // 멀티라인 블록 스타일 추적 (description:\n  line1\n  line2)
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

    // sentinel: 루프 끝에서 마지막 멀티라인 flush
    for (const line of [...lines, ""]) {
      const isIndented = /^\s+\S/.test(line);

      if (pendingKey) {
        if (isIndented || line.trim() === "") {
          // 멀티라인 계속 — 빈 줄은 구분자로만 쓰고 무시
          if (line.trim()) multilineLines.push(line.trim());
          continue;
        }
        // 들여쓰기 끝 → flush 후 아래에서 현재 라인 일반 파싱
        flushMultiline();
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();
      if (!key) continue;

      if (rawValue === "") {
        // 값이 없으면 멀티라인 블록 대기
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

      const skillPath = join(skillsDir, entry.name, "SKILL.md");
      const content = await files.scope(entry.name).readText("SKILL.md");
      if (!content) continue;

      const meta = parseFrontmatter(content);
      if (!meta.name) continue; // name만 필수

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
      } satisfies SkillMeta,
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
