import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const QMD_SEMANTIC_INSTALL_MSG = "Semantic memory is not installed.\nRun: duru memory model install";

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
  [key: string]: unknown;
};

type QmdCollectionConfig = {
  path?: string;
  pattern?: string;
  glob?: string;
  [key: string]: unknown;
};

type QmdSdkStore = {
  internal?: { llm?: unknown };
  update(options?: { collections?: string[] }): Promise<unknown>;
  embed(options?: { collection?: string; force?: boolean }): Promise<unknown>;
  searchLex(query: string, options?: { collection?: string; limit?: number }): Promise<unknown[]>;
  searchVector(query: string, options?: { collection?: string; limit?: number }): Promise<unknown[]>;
  search(options: { query: string; collection?: string; limit?: number; rerank?: boolean }): Promise<unknown[]>;
  close(): Promise<void>;
};

type QmdSdkModule = {
  createStore(options: { dbPath: string; configPath: string }): Promise<QmdSdkStore>;
};

type QmdLlmModule = {
  resolveModels(config?: Partial<Record<QmdModelRole, string>>): Record<QmdModelRole, string>;
  pullModels(models: string[], options?: { refresh?: boolean; cacheDir?: string }): Promise<unknown>;
  LlamaCpp?: new (config?: {
    embedModel?: string;
    generateModel?: string;
    rerankModel?: string;
    modelCacheDir?: string;
    inactivityTimeoutMs?: number;
    disposeModelsOnInactivity?: boolean;
  }) => unknown;
};

type QmdClientDeps = {
  importQmd?: () => Promise<QmdSdkModule>;
  importQmdLlm?: () => Promise<QmdLlmModule>;
};

export function createQmdClient(dataDir: string, clientDeps: QmdClientDeps = {}): QmdClient {
  const paths = qmdPaths(dataDir);
  const deps: Required<QmdClientDeps> = {
    importQmd: clientDeps.importQmd ?? importQmdSdk,
    importQmdLlm: clientDeps.importQmdLlm ?? importQmdLlm,
  };

  async function isAvailable(): Promise<boolean> {
    try {
      await deps.importQmd();
      await deps.importQmdLlm();
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
    const llm = await deps.importQmdLlm();
    return llm.resolveModels(await readModelConfig(paths.configPath));
  }

  async function semanticStatus(): Promise<QmdModelStatus> {
    const models = await activeModels();
    await mkdir(paths.modelsDir, { recursive: true });
    const roles = await Promise.all(
      (Object.entries(models) as Array<[QmdModelRole, string]>).map(async ([role, model]) => {
        const file = modelFileName(model);
        const installedPath = join(paths.modelsDir, file);
        const stats = await fileStats(installedPath);
        return {
          role,
          model,
          file: installedPath,
          installed: Boolean(stats),
          ...(stats ? { sizeBytes: stats.size } : {}),
        };
      }),
    );
    return {
      installed: roles.every((role) => role.installed),
      modelsDir: paths.modelsDir,
      roles,
    };
  }

  async function installModels(options: QmdInstallOptions = {}): Promise<QmdModelStatus> {
    const llm = await deps.importQmdLlm();
    const models = llm.resolveModels(await readModelConfig(paths.configPath));
    await mkdir(paths.modelsDir, { recursive: true });
    await llm.pullModels([models.embed, models.generate, models.rerank], {
      refresh: options.refresh === true,
      cacheDir: paths.modelsDir,
    });
    return await semanticStatus();
  }

  async function update(): Promise<void> {
    await withStore(paths, deps, async (store) => {
      await store.update();
    });
  }

  async function embed(collection: string): Promise<void> {
    await requireSemanticInstalled();
    await withStore(paths, deps, async (store) => {
      await store.embed({ collection });
    });
  }

  async function reindexInBackground(collection: string, options: QmdReindexOptions = {}): Promise<void> {
    const shouldVector =
      options.vector === true || (options.vector === "if-installed" && (await semanticStatus()).installed);
    void (async () => {
      try {
        await update();
        if (shouldVector) await embed(collection);
      } catch {}
    })();
  }

  async function lex(query: string, collection: string): Promise<QmdSearchResult[]> {
    return await withStore(paths, deps, async (store) =>
      mapResults(await store.searchLex(query, { collection, limit: 10 })),
    );
  }

  async function vsearch(query: string, collection: string): Promise<QmdSearchResult[]> {
    await requireSemanticInstalled();
    return await withStore(paths, deps, async (store) =>
      mapResults(await store.searchVector(query, { collection, limit: 10 })),
    );
  }

  async function query(queryStr: string, collection: string): Promise<QmdSearchResult[]> {
    await requireSemanticInstalled();
    return await withStore(paths, deps, async (store) =>
      mapResults(await store.search({ query: queryStr, collection, limit: 10, rerank: true })),
    );
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

async function importQmdLlm(): Promise<QmdLlmModule> {
  const req = createRequire(import.meta.url);
  const pkgJsonPath = req.resolve("@tobilu/qmd/package.json");
  const llmPath = resolve(dirname(pkgJsonPath), "dist", "llm.js");
  return (await import(pathToFileURL(llmPath).href)) as QmdLlmModule;
}

async function importQmdSdk(): Promise<QmdSdkModule> {
  const moduleName = "@tobilu/qmd";
  return (await import(moduleName)) as QmdSdkModule;
}

async function withStore<T>(
  paths: ReturnType<typeof qmdPaths>,
  deps: Required<QmdClientDeps>,
  run: (store: QmdSdkStore) => Promise<T>,
): Promise<T> {
  await mkdir(paths.root, { recursive: true });
  const qmd = await deps.importQmd();
  const store = await qmd.createStore({ dbPath: paths.dbPath, configPath: paths.configPath });
  await configureStoreLlm(store, paths, deps);
  try {
    return await run(store);
  } finally {
    await store.close();
  }
}

async function configureStoreLlm(
  store: QmdSdkStore,
  paths: ReturnType<typeof qmdPaths>,
  deps: Required<QmdClientDeps>,
): Promise<void> {
  if (!store.internal) return;
  const llm = await deps.importQmdLlm();
  if (!llm.LlamaCpp) return;
  const models = llm.resolveModels(await readModelConfig(paths.configPath));
  store.internal.llm = new llm.LlamaCpp({
    embedModel: models.embed,
    generateModel: models.generate,
    rerankModel: models.rerank,
    modelCacheDir: paths.modelsDir,
    inactivityTimeoutMs: 5 * 60 * 1000,
    disposeModelsOnInactivity: true,
  });
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

function mapResults(raw: readonly unknown[]): QmdSearchResult[] {
  return raw.map((item) => {
    const record = item as {
      name?: string;
      file?: string;
      path?: string;
      displayPath?: string;
      score?: number;
      excerpt?: string;
      snippet?: string;
      text?: string;
    };
    return {
      name: record.name ?? record.file ?? record.path ?? record.displayPath ?? "",
      score: record.score ?? 0,
      excerpt: record.excerpt ?? record.snippet ?? record.text ?? "",
    };
  });
}

function modelFileName(model: string): string {
  return model.split("/").at(-1) ?? model;
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
