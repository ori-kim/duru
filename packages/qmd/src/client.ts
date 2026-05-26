import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const execFileAsync = promisify(execFile);

export type QmdSearchResult = {
  name: string;
  score: number;
  excerpt: string;
};

export type QmdClient = {
  isAvailable(): Promise<boolean>;
  ensureCollection(name: string, path: string, glob?: string): Promise<void>;
  update(): Promise<void>;
  embed(collection: string): Promise<void>;
  reindexInBackground(collection: string): Promise<void>;
  lex(query: string, collection: string): Promise<QmdSearchResult[]>;
  vsearch(query: string, collection: string): Promise<QmdSearchResult[]>;
  query(query: string, collection: string): Promise<QmdSearchResult[]>;
  dataDir: string;
};

type QmdConfig = {
  collections?: Record<string, QmdCollectionConfig>;
  [key: string]: unknown;
};

type QmdCollectionConfig = {
  path?: string;
  pattern?: string;
  glob?: string;
  [key: string]: unknown;
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
        typeof pkgJson.bin === "string" ? pkgJson.bin : (pkgJson.bin?.qmd ?? Object.values(pkgJson.bin ?? {})[0]);
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
    // config 파일에 컬렉션 설정을 직접 기록해 pattern 범위를 보장한다.
    // qmd는 XDG_CONFIG_HOME/qmd/index.yml 을 읽는다.
    const configDir = join(dataDir, "config", "qmd");
    const configPath = join(configDir, "index.yml");

    let config: QmdConfig = {};
    try {
      const raw = await readFile(configPath, "utf8");
      config = (parseYaml(raw) as QmdConfig | null) ?? {};
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
    }

    const collections = config.collections ?? {};
    const existing = collections[name] ?? {};
    if (existing.path === path && existing.pattern === glob && !existing.glob) return;

    const { glob: _oldGlob, ...rest } = existing;
    collections[name] = { ...rest, path, pattern: glob };
    config.collections = collections;

    await mkdir(configDir, { recursive: true });
    await writeFile(configPath, stringifyYaml(config), "utf8");
  }

  async function update(): Promise<void> {
    await run(["update"]);
  }

  async function embed(collection: string): Promise<void> {
    await run(["embed", "-c", collection]);
  }

  async function reindexInBackground(collection: string): Promise<void> {
    const bin = await resolveBin();
    const child = spawn("sh", ["-c", '"$0" update && "$0" embed -c "$1"', bin, collection], {
      detached: true,
      env: qmdEnv(),
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  }

  function parseResults(raw: string): QmdSearchResult[] {
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
  }

  async function lex(query: string, collection: string): Promise<QmdSearchResult[]> {
    return parseResults(await run(["search", query, "-c", collection, "--json"]));
  }

  async function vsearch(query: string, collection: string): Promise<QmdSearchResult[]> {
    return parseResults(await run(["vsearch", query, "-c", collection, "--json"]));
  }

  async function query(queryStr: string, collection: string): Promise<QmdSearchResult[]> {
    return parseResults(await run(["query", queryStr, "-c", collection, "--json"]));
  }

  return { isAvailable, ensureCollection, update, embed, reindexInBackground, lex, vsearch, query, dataDir };
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
