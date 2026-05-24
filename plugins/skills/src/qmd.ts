import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const QMD_INSTALL_MSG = `qmd가 설치되지 않았습니다.
  bun install -g @tobilu/qmd`;

export async function isQmdAvailable(): Promise<boolean> {
  try {
    await execFileAsync("qmd", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function ensureCollection(skillsDir: string): Promise<void> {
  // qmd status --json으로 현재 컬렉션 목록 확인
  let hasSkillsCollection = false;
  try {
    const { stdout } = await execFileAsync("qmd", ["status", "--json"]);
    const parsed = JSON.parse(stdout) as { collections?: Array<{ name?: string }> };
    const collections = parsed.collections ?? [];
    hasSkillsCollection = collections.some(
      (c) => c.name === "skills",
    );
  } catch {
    // 파싱 실패 또는 qmd 오류 시 일단 add 시도
    hasSkillsCollection = false;
  }

  if (!hasSkillsCollection) {
    await execFileAsync("qmd", ["collection", "add", skillsDir, "--name", "skills"]);
  }
}

export async function embed(skillsDir: string): Promise<void> {
  await ensureCollection(skillsDir);
  await execFileAsync("qmd", ["embed", "-c", "skills"]);
}

export type QmdSearchResult = {
  name: string;
  score: number;
  excerpt: string;
};

export async function search(
  query: string,
  opts?: { tag?: string },
): Promise<QmdSearchResult[]> {
  let results: QmdSearchResult[] = [];

  try {
    const { stdout } = await execFileAsync("qmd", ["query", query, "-c", "skills", "--json"]);
    const parsed = JSON.parse(stdout) as Array<{
      name?: string;
      file?: string;
      score?: number;
      excerpt?: string;
      snippet?: string;
    }>;

    results = parsed.map((item) => ({
      // qmd가 파일명 또는 name 필드로 반환할 수 있음
      name: item.name ?? (item.file ? item.file.replace(/\.md$/i, "") : ""),
      score: item.score ?? 0,
      excerpt: item.excerpt ?? item.snippet ?? "",
    }));
  } catch {
    // 파싱 실패 또는 qmd 오류 시 빈 배열 반환
    return [];
  }

  // 태그 필터 (클라이언트 사이드)
  if (opts?.tag) {
    const tag = opts.tag;
    // 이름으로 store에서 조회할 수 없으므로, name 필드에서 태그 정보가 있으면 필터
    // 실제 태그 필터는 store와 연동이 필요하지만 여기서는 name 기반 필터만 지원
    results = results.filter((r) => r.name.includes(tag));
  }

  return results;
}

export async function status(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("qmd", ["status"]);
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`qmd status failed: ${message}`);
  }
}
