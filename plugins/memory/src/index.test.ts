import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli, help, isHelpDocument } from "@duru/cli-kit";
import { textRendererPlugin } from "@duru/renderer-text";
import { createMemoryPlugin } from "./index.ts";
import type { MemoryQmdClient } from "./qmd.ts";

describe("@duru/plugin-memory", () => {
  test("exposes memory commands without a list command", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const result = await cli.run(["memory", "--help"], { render: false });

      expect(isHelpDocument(result.result)).toBe(true);
      const helpDoc = result.result as { routes: Array<{ pattern: string }> };
      const patterns = helpDoc.routes.map((route) => route.pattern).filter((pattern) => pattern.startsWith("memory"));
      expect(patterns).toContain("memory add [text]");
      expect(patterns).toContain("memory search <query>");
      expect(patterns).toContain("memory show <id>");
      expect(patterns).toContain("memory tag <id> [...tags]");
      expect(patterns).toContain("memory delete <id>");
      expect(patterns).toContain("memory clean");
      expect(patterns).toContain("memory reindex");
      expect(patterns).toContain("memory status");
      expect(patterns).not.toContain("memory list");
    });
  });

  test("explains that mutation commands start background indexing by default", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const result = await cli.run(["memory", "add", "--help"]);

      expect(result.rendered?.stdout ?? "").toContain("background reindex");
      expect(result.rendered?.stdout ?? "").toContain("--no-index");
    });
  });

  test("adds inline memory through returned results and starts background indexing by default", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const captured = await captureOutput(() =>
        cli.run(["memory", "add", "renderer output belongs in results", "--tag", "renderer"], { render: false }),
      );

      expect(captured.stdout).toBe("");
      expect(captured.stderr).toBe("");
      expect(captured.result.exitCode).toBe(0);
      expect(captured.result.result).toMatchObject({
        item: {
          body: "renderer output belongs in results",
          meta: {
            id: "20260527-120405-renderer-output-belongs-in-results",
            tags: ["renderer"],
          },
        },
        indexing: { scheduled: true },
        text: "Added memory: 20260527-120405-renderer-output-belongs-in-results",
      });
      expect(qmd.calls).toEqual([
        ["ensureCollection", "memory", join(home, "memory"), "items/**/*.md"],
        ["reindexInBackground", "memory"],
      ]);

      await cli.run(["memory", "add", "bulk import", "--no-index"], { render: false });
      expect(qmd.calls).toHaveLength(2);
    });
  });

  test("search dispatches qmd mode, filters by frontmatter tag, and does not touch usage", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const first = await cli.run(["memory", "add", "skills split from memory", "--tag", "skills", "--no-index"], {
        render: false,
      });
      const second = await cli.run(["memory", "add", "personal reminder", "--tag", "personal", "--no-index"], {
        render: false,
      });
      const firstId = addResult(first.result).item.meta.id;
      const secondId = addResult(second.result).item.meta.id;
      qmd.results.query = [
        { name: firstId, score: 0.9, excerpt: "skills split" },
        { name: secondId, score: 0.5, excerpt: "personal" },
      ];

      const result = await cli.run(["memory", "search", "split", "--tag", "skills"], { render: false });

      expect(result.exitCode).toBe(0);
      expect(result.result).toMatchObject({
        results: [{ id: firstId, score: 0.9, excerpt: "skills split" }],
        items: [expect.stringContaining(firstId)],
      });
      expect(qmd.calls).toContainEqual(["query", "split", "memory"]);

      const show = await cli.run(["memory", "show", firstId], { render: false });
      expect(showResult(show.result).item.meta.id).toBe(firstId);
      expect(await cli.run(["memory", "show", firstId], { render: false })).toMatchObject({ exitCode: 0 });
    });
  });

  test("search filters by multiple tags when repeated", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const first = await cli.run(
        [
          "memory",
          "add",
          "karavan kotlin guidelines",
          "--tag",
          "subject:karavan",
          "--tag",
          "subject:kotlin",
          "--tag",
          "intent:apply-guidelines",
          "--no-index",
        ],
        { render: false },
      );
      const second = await cli.run(
        [
          "memory",
          "add",
          "karavan stack branch",
          "--tag",
          "subject:karavan",
          "--tag",
          "intent:stack-branch",
          "--no-index",
        ],
        { render: false },
      );
      const firstId = addResult(first.result).item.meta.id;
      const secondId = addResult(second.result).item.meta.id;
      qmd.results.query = [
        { name: firstId, score: 0.9, excerpt: "karavan kotlin" },
        { name: secondId, score: 0.8, excerpt: "karavan stack" },
      ];

      const subjectOnly = await cli.run(["memory", "search", "karavan", "--tag", "subject:karavan"], {
        render: false,
      });
      const subjectAndIntent = await cli.run(
        ["memory", "search", "karavan", "--tag", "subject:karavan", "--tag", "intent:apply-guidelines"],
        { render: false },
      );
      const subjectAndIntentCsv = await cli.run(
        ["memory", "search", "karavan", "--tag", "subject:karavan,intent:apply-guidelines"],
        { render: false },
      );

      expect(searchIds(subjectOnly.result)).toEqual([firstId, secondId]);
      expect(searchIds(subjectAndIntent.result)).toEqual([firstId]);
      expect(searchIds(subjectAndIntentCsv.result)).toEqual([firstId]);
    });
  });

  test("renders qmd search errors instead of returning empty results", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();
    qmd.failQuery = new Error("qmd search failed");

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);

      await expect(cli.run(["memory", "search", "split"], { render: false })).resolves.toMatchObject({
        exitCode: 1,
        result: { message: "qmd search failed" },
      });
    });
  });

  test("tag, delete, clean, reindex, and status return renderer-ready results", async () => {
    const home = await tempHome();
    const qmd = createQmdMock();

    await withDuruHome(home, async () => {
      const cli = await createMemoryCli(qmd);
      const added = await cli.run(["memory", "add", "short lived", "--no-index"], { render: false });
      const id = addResult(added.result).item.meta.id;

      await expect(cli.run(["memory", "tag", id, "kept", "--no-index"], { render: false })).resolves.toMatchObject({
        exitCode: 0,
        result: { item: { meta: { tags: ["kept"] } } },
      });
      await expect(cli.run(["memory", "delete", id], { render: false })).resolves.toMatchObject({
        exitCode: 2,
        result: { message: "memory delete requires --force" },
      });
      await expect(cli.run(["memory", "delete", "missing", "--force"], { render: false })).resolves.toMatchObject({
        exitCode: 1,
        result: { message: "Memory not found: missing" },
      });
      await expect(cli.run(["memory", "delete", id, "--force"], { render: false })).resolves.toMatchObject({
        exitCode: 0,
        result: { id, text: `Deleted memory: ${id}` },
      });
      await expect(cli.run(["memory", "clean", "--dry-run"], { render: false })).resolves.toMatchObject({
        exitCode: 0,
        result: { candidates: [], removed: [] },
      });
      await expect(cli.run(["memory", "reindex"], { render: false })).resolves.toMatchObject({
        exitCode: 0,
        result: { text: "Reindexed memory" },
      });
      expect(qmd.calls).toContainEqual(["update"]);
      expect(qmd.calls).toContainEqual(["embed", "memory"]);
      await expect(cli.run(["memory", "status"], { render: false })).resolves.toMatchObject({
        exitCode: 0,
        result: {
          qmdAvailable: true,
          memoryDir: join(home, "memory"),
          itemsDir: join(home, "memory", "items"),
        },
      });
    });
  });
});

async function createMemoryCli(qmd: MemoryQmdClient) {
  const cli = createCli({ name: "duru" }).use(textRendererPlugin()).use(help());
  await createMemoryPlugin({ qmd, now: () => new Date("2026-05-27T03:04:05.000Z"), timeZone: "Asia/Seoul" }).install(
    cli,
  );
  return cli;
}

function addResult(value: unknown): { item: { meta: { id: string } } } {
  return value as { item: { meta: { id: string } } };
}

function showResult(value: unknown): { item: { meta: { id: string } } } {
  return value as { item: { meta: { id: string } } };
}

function searchIds(value: unknown): string[] {
  const result = value as { results: Array<{ id: string }> };
  return result.results.map((item) => item.id);
}

function createQmdMock() {
  const calls: unknown[][] = [];
  const results = {
    lex: [] as Array<{ name: string; score: number; excerpt: string }>,
    vec: [] as Array<{ name: string; score: number; excerpt: string }>,
    query: [] as Array<{ name: string; score: number; excerpt: string }>,
  };
  const qmd: MemoryQmdClient & { calls: unknown[][]; results: typeof results; failQuery?: Error } = {
    calls,
    results,
    dataDir: "",
    async isAvailable() {
      calls.push(["isAvailable"]);
      return true;
    },
    async ensureCollection(name, path, glob) {
      calls.push(["ensureCollection", name, path, glob]);
    },
    async embed(collection) {
      calls.push(["embed", collection]);
    },
    async update() {
      calls.push(["update"]);
    },
    async reindexInBackground(collection) {
      calls.push(["reindexInBackground", collection]);
    },
    async lex(query, collection) {
      calls.push(["lex", query, collection]);
      return results.lex;
    },
    async vsearch(query, collection) {
      calls.push(["vsearch", query, collection]);
      return results.vec;
    },
    async query(query, collection) {
      calls.push(["query", query, collection]);
      if (qmd.failQuery) throw qmd.failQuery;
      return results.query;
    },
  };
  return qmd;
}

async function tempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "duru-memory-plugin-test-"));
}

async function withDuruHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.DURU_HOME;
  process.env.DURU_HOME = home;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "DURU_HOME");
    } else {
      process.env.DURU_HOME = previous;
    }
  }
}

async function captureOutput<T>(run: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await run(), stdout, stderr };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}
