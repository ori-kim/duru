import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const execFileAsync = promisify(execFile);

export const QMD_SEMANTIC_INSTALL_MSG = "Semantic memory is not installed.\nRun: duru memory model install";

const DEFAULT_MODELS: Record<QmdModelRole, string> = {
  embed: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  generate: "hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf",
  rerank: "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf",
};

export type QmdSearchResult = {
  name: string;
  score: number;
  excerpt: string;
};

export type QmdModelRole = "embed" | "generate" | "rerank";

export type QmdModelStatus = {
  installed: boolean;
  modelsDir: string;
  roles: Array<{
    role: QmdModelRole;
    model: string;
    file: string;
    installed: boolean;
    sizeBytes?: number;
  }>;
};

export type QmdInstallOptions = {
  refresh?: boolean;
};

export type QmdReindexOptions = {
  vector?: boolean | "if-installed";
};

export type QmdClient = {
  isAvailable(): Promise<boolean>;
  ensureCollection(name: string, path: string, glob?: string): Promise<void>;
  semanticStatus(): Promise<QmdModelStatus>;
  installModels(options?: QmdInstallOptions): Promise<QmdModelStatus>;
  update(): Promise<void>;
  embed(collection: string): Promise<void>;
  reindexInBackground(collection: string, options?: QmdReindexOptions): Promise<void>;
  lex(query: string, collection: string): Promise<QmdSearchResult[]>;
  vsearch(query: string, collection: string): Promise<QmdSearchResult[]>;
  query(query: string, collection: string): Promise<QmdSearchResult[]>;
  dataDir: string;
};

type QmdConfig = {
  collections?: Record<string, QmdCollectionConfig>;
  models?: Partial<Record<QmdModelRole, string>>;
  [key: string]: unknown;
};

type QmdCollectionConfig = {
  path?: string;
  pattern?: string;
  glob?: string;
  [key: string]: unknown;
};

export type QmdClientOptions = {
  env?: NodeJS.ProcessEnv;
  qmdPackageRoot?: string;
  runner?: string;
};

type QmdCommand = {
  file: string;
  argsPrefix: string[];
};

export function createQmdClient(dataDir: string, options: QmdClientOptions = {}): QmdClient {
  const paths = qmdPaths(dataDir);
  let _command: QmdCommand | null = null;

  async function resolvePackageRoot(): Promise<string | null> {
    if (options.qmdPackageRoot) return options.qmdPackageRoot;
    if (options.env?.DURU_QMD_PACKAGE_ROOT) return options.env.DURU_QMD_PACKAGE_ROOT;
    if (process.env.DURU_QMD_PACKAGE_ROOT) return process.env.DURU_QMD_PACKAGE_ROOT;
    try {
      const req = createRequire(import.meta.url);
      const pkgJsonPath = req.resolve("@tobilu/qmd/package.json");
      return dirname(pkgJsonPath);
    } catch {
      return null;
    }
  }

  async function resolveCommand(): Promise<QmdCommand> {
    if (_command) return _command;

    const env = baseEnv();
    if (env.DURU_QMD_BIN) {
      _command = { file: env.DURU_QMD_BIN, argsPrefix: [] };
      return _command;
    }

    const packageRoot = await resolvePackageRoot();
    if (packageRoot) {
      const distCli = resolve(packageRoot, "dist/cli/qmd.js");
      if (await exists(distCli)) {
        _command = { file: options.runner ?? env.DURU_QMD_RUNNER ?? "bun", argsPrefix: [distCli] };
        return _command;
      }

      const bin = await resolvePackageBin(packageRoot);
      if (bin) {
        _command = { file: bin, argsPrefix: [] };
        return _command;
      }
    }

    _command = { file: "qmd", argsPrefix: [] };
    return _command;
  }

  async function resolvePackageBin(packageRoot: string): Promise<string | null> {
    try {
      const pkgJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
        bin?: Record<string, string> | string;
      };
      const binEntry =
        typeof pkgJson.bin === "string" ? pkgJson.bin : (pkgJson.bin?.qmd ?? Object.values(pkgJson.bin ?? {})[0]);
      return binEntry ? resolve(packageRoot, binEntry) : null;
    } catch {
      return null;
    }
  }

  function baseEnv(): NodeJS.ProcessEnv {
    return options.env ?? process.env;
  }

  function qmdEnv(): NodeJS.ProcessEnv {
    const env = baseEnv();
    return {
      ...env,
      NO_COLOR: env.NO_COLOR ?? "1",
      QMD_FORCE_CPU: env.QMD_FORCE_CPU ?? "1",
      XDG_CACHE_HOME: dataDir,
      XDG_CONFIG_HOME: dataDir,
    };
  }

  async function run(args: string[]): Promise<string> {
    const command = await resolveCommand();
    const { stdout } = await execFileAsync(command.file, [...command.argsPrefix, ...args], { env: qmdEnv() });
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
    const configDir = paths.root;
    const configPath = paths.configPath;

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

  async function activeModels(): Promise<Record<QmdModelRole, string>> {
    const env = baseEnv();
    const config = await readModelConfig(paths.configPath);
    return {
      embed: config.embed ?? env.QMD_EMBED_MODEL ?? DEFAULT_MODELS.embed,
      generate: config.generate ?? env.QMD_GENERATE_MODEL ?? DEFAULT_MODELS.generate,
      rerank: config.rerank ?? env.QMD_RERANK_MODEL ?? DEFAULT_MODELS.rerank,
    };
  }

  async function semanticStatus(): Promise<QmdModelStatus> {
    const models = await activeModels();
    await mkdir(paths.modelsDir, { recursive: true });
    const roles = await Promise.all(
      (Object.entries(models) as Array<[QmdModelRole, string]>).map(async ([role, model]) => {
        const candidates = modelCandidates(model, paths.modelsDir);
        for (const file of candidates) {
          const stats = await fileStats(file);
          if (stats) return { role, model, file, installed: true, sizeBytes: stats.size };
        }
        return { role, model, file: candidates[0] ?? join(paths.modelsDir, modelFileName(model)), installed: false };
      }),
    );
    return {
      installed: roles.every((role) => role.installed),
      modelsDir: paths.modelsDir,
      roles,
    };
  }

  async function installModels(options: QmdInstallOptions = {}): Promise<QmdModelStatus> {
    await run(["pull", ...(options.refresh === true ? ["--refresh"] : [])]);
    return await semanticStatus();
  }

  async function update(): Promise<void> {
    await run(["update"]);
  }

  async function embed(collection: string): Promise<void> {
    await requireSemanticInstalled();
    await run(["embed", "-c", collection]);
  }

  async function reindexInBackground(collection: string, options: QmdReindexOptions = {}): Promise<void> {
    const shouldVector =
      options.vector === true || (options.vector === "if-installed" && (await semanticStatus()).installed);
    const command = await resolveCommand();
    const commandPrefix = [command.file, ...command.argsPrefix].map(shellQuote).join(" ");
    const script = shouldVector
      ? `${commandPrefix} update && ${commandPrefix} embed -c ${shellQuote(collection)}`
      : `${commandPrefix} update`;
    const child = spawn("sh", ["-c", script], {
      detached: true,
      env: qmdEnv(),
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  }

  async function lex(query: string, collection: string): Promise<QmdSearchResult[]> {
    return parseResults(await run(["search", query, "-c", collection, "--json"]));
  }

  async function vsearch(query: string, collection: string): Promise<QmdSearchResult[]> {
    await requireSemanticInstalled();
    return parseResults(await run(["vsearch", query, "-c", collection, "--json"]));
  }

  async function query(queryStr: string, collection: string): Promise<QmdSearchResult[]> {
    await requireSemanticInstalled();
    const args = ["query", queryStr, "-c", collection, "--json"];
    if (baseEnv().DURU_QMD_RERANK !== "1") args.push("--no-rerank");
    return parseResults(await run(args));
  }

  async function requireSemanticInstalled(): Promise<void> {
    const status = await semanticStatus();
    if (!status.installed) throw new Error(QMD_SEMANTIC_INSTALL_MSG);
  }

  return {
    isAvailable,
    ensureCollection,
    semanticStatus,
    installModels,
    update,
    embed,
    reindexInBackground,
    lex,
    vsearch,
    query,
    dataDir,
  };
}

function qmdPaths(dataDir: string) {
  const root = join(dataDir, "qmd");
  return {
    root,
    dbPath: join(root, "index.sqlite"),
    configPath: join(root, "index.yml"),
    modelsDir: join(root, "models"),
  };
}

function parseResults(raw: string): QmdSearchResult[] {
  const parsed = JSON.parse(extractJsonArray(raw)) as Array<{
    name?: string;
    title?: string;
    file?: string;
    path?: string;
    displayPath?: string;
    score?: number;
    excerpt?: string;
    snippet?: string;
    text?: string;
  }>;
  return parsed.map((item) => ({
    name: item.name ?? item.title ?? item.file ?? item.path ?? item.displayPath ?? "",
    score: item.score ?? 0,
    excerpt: item.excerpt ?? item.snippet ?? item.text ?? "",
  }));
}

function extractJsonArray(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end >= start) return trimmed.slice(start, end + 1);
  return trimmed;
}

async function readModelConfig(configPath: string): Promise<Partial<Record<QmdModelRole, string>>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = (parseYaml(raw) as { models?: Partial<Record<QmdModelRole, string>> } | null) ?? {};
    return parsed.models ?? {};
  } catch (err) {
    if (isNotFoundError(err)) return {};
    throw err;
  }
}

function modelCandidates(model: string, modelsDir: string): string[] {
  const candidates = isAbsolute(model) ? [model] : [join(modelsDir, modelFileName(model))];
  const hfFile = hfModelFileName(model);
  if (hfFile) candidates.unshift(join(modelsDir, hfFile));
  return [...new Set(candidates)];
}

function hfModelFileName(model: string): string | null {
  if (!model.startsWith("hf:")) return null;
  const parts = model.slice(3).split("/");
  const owner = parts[0];
  const file = parts.at(-1);
  if (!owner || !file) return null;
  return `hf_${owner}_${file}`;
}

function modelFileName(model: string): string {
  return basename(model);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileStats(path: string): Promise<{ size: number } | null> {
  try {
    const result = await stat(path);
    return result.isFile() ? { size: result.size } : null;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
