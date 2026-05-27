import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QMD_SEMANTIC_INSTALL_MSG, createQmdClient } from "./client.ts";

describe("createQmdClient", () => {
  test("writes qmd collection config with pattern and preserves existing config", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const client = createQmdClient(dataDir);

    await client.ensureCollection("memory", "/tmp/memory", "items/*.md");

    const configPath = join(dataDir, "qmd", "index.yml");
    let raw = await readFile(configPath, "utf8");
    expect(raw).toContain("collections:");
    expect(raw).toContain("memory:");
    expect(raw).toContain("path: /tmp/memory");
    expect(raw).toContain("pattern:");
    expect(raw).toContain("items/*.md");
    expect(raw).not.toContain("glob:");

    await writeFile(
      configPath,
      [
        "collections:",
        "  memory:",
        "    path: /tmp/old-memory",
        '    glob: "**/*.md"',
        "models:",
        "  embed: local-model",
        "",
      ].join("\n"),
    );

    await client.ensureCollection("memory", "/tmp/memory", "items/*.md");

    raw = await readFile(configPath, "utf8");
    expect(raw).toContain("path: /tmp/memory");
    expect(raw).toContain("pattern:");
    expect(raw).toContain("items/*.md");
    expect(raw).toContain("models:");
    expect(raw).toContain("embed: local-model");
    expect(raw).not.toContain("glob:");
  });

  test("does not overwrite invalid qmd config", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const configPath = join(dataDir, "qmd", "index.yml");
    const client = createQmdClient(dataDir);

    await mkdir(join(dataDir, "qmd"), { recursive: true });
    await writeFile(configPath, ": [", "utf8");

    await expect(client.ensureCollection("memory", "/tmp/memory", "items/*.md")).rejects.toThrow();
    await expect(readFile(configPath, "utf8")).resolves.toBe(": [");
  });

  test("surfaces qmd search command failures", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const configPath = join(dataDir, "qmd", "index.yml");
    const client = createQmdClient(dataDir);

    await mkdir(join(dataDir, "qmd"), { recursive: true });
    await writeFile(configPath, ": [", "utf8");

    await expect(client.lex("renderer", "memory")).rejects.toThrow();
  });

  test("writes qmd collection config in the portable qmd root", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const client = createQmdClient(dataDir);

    await client.ensureCollection("memory", "/tmp/memory", "items/**/*.md");

    const raw = await readFile(join(dataDir, "qmd", "index.yml"), "utf8");
    expect(raw).toContain("collections:");
    expect(raw).toContain("memory:");
    expect(raw).toContain("path: /tmp/memory");
    expect(raw).toContain("pattern:");
    expect(raw).toContain("items/**/*.md");
  });

  test("semantic status reports missing model files without pulling models", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const runtime = createFakeQmdRuntime();
    const client = createQmdClient(dataDir, runtime.deps);

    const status = await client.semanticStatus();

    expect(status.installed).toBe(false);
    expect(status.modelsDir).toBe(join(dataDir, "qmd", "models"));
    expect(status.roles.map((role) => [role.role, role.installed])).toEqual([
      ["embed", false],
      ["generate", false],
      ["rerank", false],
    ]);
    expect(runtime.pullCalls).toEqual([]);
  });

  test("opens the sdk store with the portable sqlite and config paths", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const runtime = createFakeQmdRuntime();
    const client = createQmdClient(dataDir, runtime.deps);

    await client.update();

    expect(runtime.createStoreCalls[0]).toMatchObject({
      dbPath: join(dataDir, "qmd", "index.sqlite"),
      configPath: join(dataDir, "qmd", "index.yml"),
    });
  });

  test("lex search uses the sdk store without requiring semantic models", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const runtime = createFakeQmdRuntime();
    runtime.storeResults.lex = [{ file: "memory/items/a.md", score: 0.42, snippet: "lex result" }];
    const client = createQmdClient(dataDir, runtime.deps);

    const results = await client.lex("hello", "memory");

    expect(results).toEqual([{ name: "memory/items/a.md", score: 0.42, excerpt: "lex result" }]);
    expect(runtime.storeCalls).toContainEqual(["searchLex", "hello", { collection: "memory", limit: 10 }]);
  });

  test("vector and query search require semantic models before calling sdk search", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const runtime = createFakeQmdRuntime();
    const client = createQmdClient(dataDir, runtime.deps);

    await expect(client.vsearch("hello", "memory")).rejects.toThrow(QMD_SEMANTIC_INSTALL_MSG);
    await expect(client.query("hello", "memory")).rejects.toThrow(QMD_SEMANTIC_INSTALL_MSG);

    expect(runtime.storeCalls).not.toContainEqual(["searchVector", "hello", { collection: "memory", limit: 10 }]);
  });

  test("installModels pulls active models into the portable models directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const runtime = createFakeQmdRuntime();
    const client = createQmdClient(dataDir, runtime.deps);

    await client.installModels({ refresh: true });

    expect(runtime.pullCalls).toEqual([
      {
        requested: [
          "hf:example/embed/embed.gguf",
          "hf:example/generate/generate.gguf",
          "hf:example/rerank/rerank.gguf",
        ],
        options: { refresh: true, cacheDir: join(dataDir, "qmd", "models") },
      },
    ]);
  });
});

function createFakeQmdRuntime() {
  const createStoreCalls: unknown[] = [];
  const pullCalls: unknown[] = [];
  const storeCalls: unknown[][] = [];
  const storeResults = {
    lex: [] as unknown[],
    vector: [] as unknown[],
    query: [] as unknown[],
  };
  const models = {
    embed: "hf:example/embed/embed.gguf",
    generate: "hf:example/generate/generate.gguf",
    rerank: "hf:example/rerank/rerank.gguf",
  };
  const store = {
    async update(options?: unknown) {
      storeCalls.push(["update", options]);
      return { collections: 1, indexed: 1, updated: 0, unchanged: 0, removed: 0, needsEmbedding: 0 };
    },
    async embed(options?: unknown) {
      storeCalls.push(["embed", options]);
      return { embedded: 0, skipped: 0, failed: 0 };
    },
    async searchLex(query: string, options?: unknown) {
      storeCalls.push(["searchLex", query, options]);
      return storeResults.lex;
    },
    async searchVector(query: string, options?: unknown) {
      storeCalls.push(["searchVector", query, options]);
      return storeResults.vector;
    },
    async search(options: unknown) {
      storeCalls.push(["search", options]);
      return storeResults.query;
    },
    async close() {},
  };

  return {
    createStoreCalls,
    pullCalls,
    storeCalls,
    storeResults,
    deps: {
      async importQmd() {
        return {
          async createStore(options: unknown) {
            createStoreCalls.push(options);
            return store;
          },
        };
      },
      async importQmdLlm() {
        return {
          resolveModels: () => models,
          pullModels: async (requested: string[], options: unknown) => {
            pullCalls.push({ requested, options });
            return requested.map((model) => ({
              model,
              path: model.split("/").at(-1) ?? model,
              sizeBytes: 1,
              refreshed: false,
            }));
          },
        };
      },
    },
  };
}
