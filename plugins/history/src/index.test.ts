import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli, help, isHelpDocument } from "@duru/cli-kit";
import { createFileStore } from "@duru/file-store";
import { createHistoryStore } from "./store.ts";

const promptState = {
  selectResults: [] as string[],
  autocompleteResults: [] as string[],
};

const selectMock = mock(async () => promptState.selectResults.shift() ?? "list");
const autocompleteMock = mock(async () => promptState.autocompleteResults.shift() ?? "");

class TestClackCancelError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ClackCancelError";
  }
}

mock.module("@duru/clack/prompt", () => ({
  ClackCancelError: TestClackCancelError,
  autocomplete: autocompleteMock,
  select: selectMock,
}));

const historyPlugin = (await import("./index.ts")).default;

describe("@duru/plugin-history", () => {
  afterEach(() => {
    promptState.selectResults = [];
    promptState.autocompleteResults = [];
    selectMock.mockClear();
    autocompleteMock.mockClear();
  });

  test("exposes root, list, and pick history commands only", async () => {
    const cli = await createHistoryCli();

    const result = await cli.run(["history", "--help"], { render: false });

    expect(isHelpDocument(result.result)).toBe(true);
    const patterns = result.result.routes
      .map((route) => route.pattern)
      .filter((pattern) => pattern.startsWith("history"));
    expect(patterns).toContain("history");
    expect(patterns).toContain("history list");
    expect(patterns).toContain("history pick");
    expect(patterns).not.toContain("history rerun <id>");
    expect(patterns).not.toContain("history clear");
  });

  test("lists history explicitly through history list", async () => {
    const home = await tempHome();
    await appendHistory(home, ["agent", "hello"]);

    await withDuruHome(home, async () => {
      const cli = await createHistoryCli();

      const result = await cli.run(["history", "list", "--limit", "1"], { render: false });

      expect(result.exitCode).toBe(0);
      expect(result.result).toMatchObject({
        records: [{ argv: ["agent", "hello"] }],
        items: [expect.stringContaining("duru agent hello")],
      });
    });
  });

  test("uses configured limit for history list unless --limit is provided", async () => {
    const home = await tempHome();
    await createFileStore({ root: join(home, "history") }).write("config.yml", { limit: 2 });
    await appendHistory(home, ["agent", "one"]);
    await appendHistory(home, ["agent", "two"]);
    await appendHistory(home, ["agent", "three"]);

    await withDuruHome(home, async () => {
      const cli = await createHistoryCli();

      const configured = await cli.run(["history", "list"], { render: false });
      const overridden = await cli.run(["history", "list", "--limit", "3"], { render: false });

      expect(configured.result).toMatchObject({
        records: [{ argv: ["agent", "three"] }, { argv: ["agent", "two"] }],
      });
      expect(overridden.result).toMatchObject({
        records: [{ argv: ["agent", "three"] }, { argv: ["agent", "two"] }, { argv: ["agent", "one"] }],
      });
    });
  });

  test("filters history pick candidates with --grep and configured limit", async () => {
    const home = await tempHome();
    await createFileStore({ root: join(home, "history") }).write("config.yml", { limit: 2 });
    await appendHistory(home, ["agent", "deploy", "api"]);
    await appendHistory(home, ["agent", "test"]);
    await appendHistory(home, ["gateway", "deploy", "worker"]);
    promptState.autocompleteResults = ["missing"];

    await withDuruHome(home, async () => {
      await withStdinTTY(true, async () => {
        const cli = await createHistoryCli();

        const result = await cli.run(["history", "pick", "--grep", "deploy"], { render: false });

        expect(result.exitCode).toBe(1);
        expect(result.result).toEqual({ error: { message: "record not found: missing" } });
        expect(autocompleteMock).toHaveBeenCalledTimes(1);
        expect(autocompleteMock.mock.calls[0]?.[0]).toMatchObject({
          options: [
            expect.objectContaining({ label: "duru gateway deploy worker" }),
            expect.objectContaining({ label: "duru agent deploy api" }),
          ],
        });
      });
    });
  });

  test("skips recording commands that match configured ignore patterns", async () => {
    const home = await tempHome();
    await createFileStore({ root: join(home, "history") }).write("config.yml", {
      ignore: ["secret get", "completion"],
    });

    await withDuruHome(home, async () => {
      const cli = await createHistoryCli();
      const secret = createCli();
      secret.command("get <name>").action((ctx) => ctx.exit(0, { ok: true }, true));
      secret.command("set <name>").action((ctx) => ctx.exit(0, { ok: true }, true));
      cli.subCommand("secret", secret);

      const completion = createCli();
      completion.command("query").action((ctx) => ctx.exit(0, { ok: true }, true));
      cli.subCommand("completion", completion);

      await cli.run(["secret", "get", "token"], { render: false });
      await cli.run(["secret", "set", "token"], { render: false });
      await cli.run(["completion", "query"], { render: false });

      const records = await createHistoryStore(createFileStore({ root: join(home, "history") })).list();
      expect(records.map((record) => record.argv)).toEqual([["secret", "set", "token"]]);
    });
  });

  test("history alone prompts once on a TTY and saves the selected shortcut", async () => {
    const home = await tempHome();
    await appendHistory(home, ["skills", "list"]);
    promptState.selectResults = ["list"];

    await withDuruHome(home, async () => {
      await withStdinTTY(true, async () => {
        const cli = await createHistoryCli();

        const result = await cli.run(["history"], { render: false });

        expect(result.exitCode).toBe(0);
        expect(result.result).toMatchObject({
          records: [{ argv: ["skills", "list"] }],
        });
        expect(selectMock).toHaveBeenCalledTimes(1);
        expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
          message: expect.stringContaining("history"),
          options: [expect.objectContaining({ value: "list" }), expect.objectContaining({ value: "pick" })],
        });

        const config = await readFile(join(home, "history", "config.yml"), "utf8");
        expect(config).toContain("defaultAction: list");

        selectMock.mockClear();
        const shortcut = await cli.run(["history"], { render: false });

        expect(shortcut.exitCode).toBe(0);
        expect(shortcut.result).toMatchObject({
          records: [{ argv: ["skills", "list"] }],
        });
        expect(selectMock).not.toHaveBeenCalled();
      });
    });
  });

  test("history alone uses the configured pick shortcut without prompting", async () => {
    const home = await tempHome();
    await createFileStore({ root: join(home, "history") }).write("config.yml", { defaultAction: "pick" });

    await withDuruHome(home, async () => {
      await withStdinTTY(true, async () => {
        const cli = await createHistoryCli();

        const result = await cli.run(["history"], { render: false });

        expect(result.exitCode).toBe(0);
        expect(result.result).toEqual({ message: "history is empty" });
        expect(selectMock).not.toHaveBeenCalled();
      });
    });
  });

  test("history alone falls back to list when stdin is not a TTY", async () => {
    const home = await tempHome();
    await appendHistory(home, ["gateway", "list"]);

    await withDuruHome(home, async () => {
      await withStdinTTY(false, async () => {
        const cli = await createHistoryCli();

        const result = await cli.run(["history"], { render: false });

        expect(result.exitCode).toBe(0);
        expect(result.result).toMatchObject({
          records: [{ argv: ["gateway", "list"] }],
        });
        expect(selectMock).not.toHaveBeenCalled();
      });
    });
  });
});

async function createHistoryCli() {
  const cli = createCli({ name: "duru" }).use(help());
  await historyPlugin.install(cli);
  return cli;
}

async function tempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "duru-history-test-"));
}

async function appendHistory(home: string, argv: readonly string[]): Promise<void> {
  const store = createHistoryStore(createFileStore({ root: join(home, "history") }));
  await store.append({
    at: "2026-05-27T00:00:00.000Z",
    argv,
    cwd: home,
    status: "ok",
    exitCode: 0,
    durationMs: 1,
  });
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

async function withStdinTTY<T>(value: boolean, run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  try {
    return await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  }
}
