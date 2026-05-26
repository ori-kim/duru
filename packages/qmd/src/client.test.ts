import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQmdClient } from "./client.ts";

describe("createQmdClient", () => {
  test("writes qmd collection config with pattern and preserves existing config", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const client = createQmdClient(dataDir);

    await client.ensureCollection("memory", "/tmp/memory", "items/*.md");

    const configPath = join(dataDir, "config", "qmd", "index.yml");
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
    const configPath = join(dataDir, "config", "qmd", "index.yml");
    const client = createQmdClient(dataDir);

    await mkdir(join(dataDir, "config", "qmd"), { recursive: true });
    await writeFile(configPath, ": [", "utf8");

    await expect(client.ensureCollection("memory", "/tmp/memory", "items/*.md")).rejects.toThrow();
    await expect(readFile(configPath, "utf8")).resolves.toBe(": [");
  });

  test("surfaces qmd search command failures", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const configPath = join(dataDir, "config", "qmd", "index.yml");
    const client = createQmdClient(dataDir);

    await mkdir(join(dataDir, "config", "qmd"), { recursive: true });
    await writeFile(configPath, ": [", "utf8");

    await expect(client.lex("renderer", "memory")).rejects.toThrow();
  });
});
