import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
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
  isAvailable(): Promise<boolean>;
  ensureCollection(name: string, path: string, glob?: string): Promise<void>;
  embed(collection: string): Promise<void>;
  lex(query: string, collection: string): Promise<QmdSearchResult[]>;
  vsearch(query: string, collection: string): Promise<QmdSearchResult[]>;
  query(query: string, collection: string): Promise<QmdSearchResult[]>;
  dataDir: string;
};

export function createQmdClient(dataDir: string): QmdClient {
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
      _binPath = "qmd";
    }
    return _binPath;
  }

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

  async function ensureCollection(name: string, path: string, glob = "*/SKILL.md"): Promise<void> {
    // config 파일에 컬렉션 설정을 직접 기록해 glob 패턴을 보장한다.
    // qmd는 XDG_CONFIG_HOME/qmd/index.yml 을 읽는다.
    const configDir = join(dataDir, "config", "qmd");
    const configPath = join(configDir, "index.yml");

    let existing: Record<string, unknown> = {};
    try {
      const raw = await readFile(configPath, "utf8");
      // 단순 파싱: collections 블록 아래 이미 해당 이름이 있으면 skip
      if (raw.includes(`  ${name}:`)) return;
      existing = { _raw: raw };
    } catch {}

    await mkdir(configDir, { recursive: true });

    if (existing._raw) {
      // 기존 파일에 컬렉션 블록 추가
      const appended = `${existing._raw as string}\n  ${name}:\n    path: ${path}\n    glob: "${glob}"\n`;
      await writeFile(configPath, appended, "utf8");
    } else {
      const content = `collections:\n  ${name}:\n    path: ${path}\n    glob: "${glob}"\n`;
      await writeFile(configPath, content, "utf8");
    }
  }

  async function embed(collection: string): Promise<void> {
    await run(["embed", "-c", collection]);
  }

  function parseResults(raw: string): QmdSearchResult[] {
    try {
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

  async function lex(query: string, collection: string): Promise<QmdSearchResult[]> {
    try {
      return parseResults(await run(["search", query, "-c", collection, "--json"]));
    } catch {
      return [];
    }
  }

  async function vsearch(query: string, collection: string): Promise<QmdSearchResult[]> {
    try {
      return parseResults(await run(["vsearch", query, "-c", collection, "--json"]));
    } catch {
      return [];
    }
  }

  async function query(queryStr: string, collection: string): Promise<QmdSearchResult[]> {
    try {
      return parseResults(await run(["query", queryStr, "-c", collection, "--json"]));
    } catch {
      return [];
    }
  }

  return { isAvailable, ensureCollection, embed, lex, vsearch, query, dataDir };
}
