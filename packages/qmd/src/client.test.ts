import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  test("semantic status reports missing and installed model files without importing qmd llm", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const modelsDir = join(dataDir, "qmd", "models");
    const client = createQmdClient(dataDir);

    await expect(client.vsearch("hello", "memory")).rejects.toThrow(QMD_SEMANTIC_INSTALL_MSG);

    let status = await client.semanticStatus();
    expect(status.installed).toBe(false);
    expect(status.modelsDir).toBe(modelsDir);
    expect(status.roles.map((role) => [role.role, role.installed])).toEqual([
      ["embed", false],
      ["generate", false],
      ["rerank", false],
    ]);

    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, "hf_ggml-org_embeddinggemma-300M-Q8_0.gguf"), "embed", "utf8");
    await writeFile(join(modelsDir, "hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf"), "generate", "utf8");
    await writeFile(join(modelsDir, "hf_ggml-org_qwen3-reranker-0.6b-q8_0.gguf"), "rerank", "utf8");

    status = await client.semanticStatus();
    expect(status.installed).toBe(true);
    expect(status.roles.map((role) => [role.role, role.installed])).toEqual([
      ["embed", true],
      ["generate", true],
      ["rerank", true],
    ]);
  });

  test("runs the qmd dist CLI through an explicit runner outside the compiled binary", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "duru-qmd-client-test-"));
    const qmdPackageRoot = join(dataDir, "node_modules", "@tobilu", "qmd");
    const cliEntry = join(qmdPackageRoot, "dist", "cli", "qmd.js");
    const runner = join(dataDir, "fake-runner");
    const capturePath = join(dataDir, "capture.json");

    await mkdir(join(qmdPackageRoot, "dist", "cli"), { recursive: true });
    await mkdir(join(qmdPackageRoot, "bin"), { recursive: true });
    await writeFile(join(qmdPackageRoot, "package.json"), JSON.stringify({ bin: { qmd: "bin/qmd" } }), "utf8");
    await writeFile(cliEntry, "", "utf8");
    await writeFile(join(qmdPackageRoot, "bin", "qmd"), "", "utf8");
    await writeFile(
      runner,
      [
        "#!/usr/bin/env bun",
        `await Bun.write(${JSON.stringify(capturePath)}, JSON.stringify({`,
        "  argv: process.argv.slice(2),",
        "  qmdForceCpu: process.env.QMD_FORCE_CPU,",
        "  xdgCacheHome: process.env.XDG_CACHE_HOME,",
        "  xdgConfigHome: process.env.XDG_CONFIG_HOME,",
        "}));",
        'console.log(process.argv.includes("--version") ? "qmd 2.5.2" : "[]");',
      ].join("\n"),
      "utf8",
    );
    await chmod(runner, 0o755);

    const client = createQmdClient(dataDir, { qmdPackageRoot, runner });

    await expect(client.isAvailable()).resolves.toBe(true);

    const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
      argv: string[];
      qmdForceCpu: string;
      xdgCacheHome: string;
      xdgConfigHome: string;
    };
    expect(capture).toEqual({
      argv: [cliEntry, "--version"],
      qmdForceCpu: "1",
      xdgCacheHome: dataDir,
      xdgConfigHome: dataDir,
    });

    const explicitCpuClient = createQmdClient(dataDir, {
      env: { ...process.env, QMD_FORCE_CPU: "0" },
      qmdPackageRoot,
      runner,
    });
    await expect(explicitCpuClient.isAvailable()).resolves.toBe(true);
    const explicitCpuCapture = JSON.parse(await readFile(capturePath, "utf8")) as {
      qmdForceCpu: string;
    };
    expect(explicitCpuCapture.qmdForceCpu).toBe("0");

    await writeInstalledModelFiles(dataDir);

    await expect(client.query("where is memory", "memory")).resolves.toEqual([]);
    const queryCapture = JSON.parse(await readFile(capturePath, "utf8")) as {
      argv: string[];
    };
    expect(queryCapture.argv).toEqual([cliEntry, "query", "where is memory", "-c", "memory", "--json", "--no-rerank"]);

    const rerankClient = createQmdClient(dataDir, {
      env: { ...process.env, DURU_QMD_RERANK: "1" },
      qmdPackageRoot,
      runner,
    });
    await expect(rerankClient.query("where is memory", "memory")).resolves.toEqual([]);
    const rerankCapture = JSON.parse(await readFile(capturePath, "utf8")) as {
      argv: string[];
    };
    expect(rerankCapture.argv).toEqual([cliEntry, "query", "where is memory", "-c", "memory", "--json"]);

    await expect(client.installModels({ refresh: true })).resolves.toMatchObject({ installed: true });
    const installCapture = JSON.parse(await readFile(capturePath, "utf8")) as {
      argv: string[];
    };
    expect(installCapture.argv).toEqual([cliEntry, "pull", "--refresh"]);
  });
});

async function writeInstalledModelFiles(dataDir: string): Promise<void> {
  const modelsDir = join(dataDir, "qmd", "models");
  await mkdir(modelsDir, { recursive: true });
  await writeFile(join(modelsDir, "hf_ggml-org_embeddinggemma-300M-Q8_0.gguf"), "embed", "utf8");
  await writeFile(join(modelsDir, "hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf"), "generate", "utf8");
  await writeFile(join(modelsDir, "hf_ggml-org_qwen3-reranker-0.6b-q8_0.gguf"), "rerank", "utf8");
}
