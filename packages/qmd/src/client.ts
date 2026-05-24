import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type QmdSearchResult = {
  name: string;
  score: number;
  excerpt: string;
};

export type QmdClient = {
  /** qmd 바이너리가 사용 가능한지 확인 */
  isAvailable(): Promise<boolean>;
  /** 컬렉션 등록 (없을 때만) */
  ensureCollection(name: string, path: string): Promise<void>;
  /** 인덱싱 */
  embed(collection: string): Promise<void>;
  /** 하이브리드 검색 */
  search(query: string, collection: string): Promise<QmdSearchResult[]>;
  /** 상태 raw 출력 */
  status(): Promise<string>;
  /** 데이터가 저장되는 루트 디렉터리 */
  dataDir: string;
};

/**
 * 포터블 qmd 클라이언트를 생성한다.
 *
 * - `@tobilu/qmd` 바이너리를 node_modules에서 직접 참조 → PATH 무관
 * - `XDG_CACHE_HOME` / `XDG_CONFIG_HOME` 을 dataDir 하위로 격리
 *   → 사용자 전역 qmd 설정·인덱스와 완전히 분리
 *
 * @param dataDir  인덱스·모델·설정을 저장할 루트 (e.g. DURU_HOME/skills/.data)
 */
export function createQmdClient(dataDir: string): QmdClient {
  // node_modules 안의 @tobilu/qmd 바이너리 경로를 런타임에 계산
  // 실패 시 PATH의 qmd로 폴백
  let _binPath: string | null = null;

  async function resolveBin(): Promise<string> {
    if (_binPath) return _binPath;
    try {
      const req = createRequire(import.meta.url);
      const pkgJsonPath = req.resolve("@tobilu/qmd/package.json");
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf8")) as {
        bin?: Record<string, string> | string;
      };
      const binEntry =
        typeof pkgJson.bin === "string"
          ? pkgJson.bin
          : (pkgJson.bin?.qmd ?? Object.values(pkgJson.bin ?? {})[0]);
      if (!binEntry) throw new Error("bin not found");
      _binPath = resolve(dirname(pkgJsonPath), binEntry);
    } catch {
      _binPath = "qmd"; // PATH 폴백
    }
    return _binPath;
  }

  /** XDG 환경변수로 qmd 데이터를 dataDir 하위에 격리 */
  function qmdEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      XDG_CACHE_HOME: join(dataDir, "cache"),
      XDG_CONFIG_HOME: join(dataDir, "config"),
    };
  }

  async function run(args: string[]): Promise<string> {
    const bin = await resolveBin();
    const { stdout } = await execFileAsync(bin, args, { env: qmdEnv() });
    return stdout;
  }

  async function isAvailable(): Promise<boolean> {
    try {
      await run(["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureCollection(name: string, path: string): Promise<void> {
    try {
      const raw = await run(["status", "--json"]);
      const parsed = JSON.parse(raw) as {
        collections?: Array<{ name?: string }>;
      };
      const exists = (parsed.collections ?? []).some((c) => c.name === name);
      if (exists) return;
    } catch {
      // status 실패해도 add 시도
    }
    await run(["collection", "add", path, "--name", name]);
  }

  async function embed(collection: string): Promise<void> {
    await run(["embed", "-c", collection]);
  }

  async function search(
    query: string,
    collection: string,
  ): Promise<QmdSearchResult[]> {
    try {
      const raw = await run(["query", query, "-c", collection, "--json"]);
      const parsed = JSON.parse(raw) as Array<{
        name?: string;
        file?: string;
        score?: number;
        excerpt?: string;
        snippet?: string;
      }>;
      return parsed.map((item) => ({
        name: item.name ?? item.file?.replace(/\.md$/i, "") ?? "",
        score: item.score ?? 0,
        excerpt: item.excerpt ?? item.snippet ?? "",
      }));
    } catch {
      return [];
    }
  }

  async function status(): Promise<string> {
    return run(["status"]);
  }

  return { isAvailable, ensureCollection, embed, search, status, dataDir };
}
