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
  isAvailable(): Promise<boolean>;
  ensureCollection(name: string, path: string): Promise<void>;
  embed(collection: string): Promise<void>;
  search(query: string, collection: string): Promise<QmdSearchResult[]>;
  status(): Promise<string>;
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

  async function ensureCollection(name: string, path: string): Promise<void> {
    try {
      const raw = await run(["status", "--json"]);
      const parsed = JSON.parse(raw) as {
        collections?: Array<{ name?: string }>;
      };
      const exists = (parsed.collections ?? []).some((c) => c.name === name);
      if (exists) return;
    } catch {
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
