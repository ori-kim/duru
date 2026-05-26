import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SecretProvider, createResolver, loadManifest } from "@duru/secrets";
import { secretExport, secretImport } from "./import-export.ts";

const tmpDirs: string[] = [];

function tmpdirpath(): string {
  const d = mkdtempSync(join(tmpdir(), "duru-importexport-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function memoryProvider(scheme: string): SecretProvider {
  const store = new Map<string, string>();
  return {
    scheme,
    async get(p) {
      return store.get(p);
    },
    async set(p, v) {
      store.set(p, v);
    },
    async delete(p) {
      store.delete(p);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

describe("secretImport", () => {
  it("imports .env entries into manifest + backend", async () => {
    const dir = tmpdirpath();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "GITHUB_TOKEN=ghtok\nAWS_KEY=awsk\n");
    const manifestPath = join(dir, "duru.secrets.json");
    const provider = memoryProvider("keychain");
    const resolver = createResolver([provider]);

    const result = await secretImport({
      manifestPath,
      resolver,
      envFile,
      backend: "keychain",
    });

    expect(result.added.sort()).toEqual(["AWS_KEY", "GITHUB_TOKEN"]);
    expect(result.skipped).toEqual([]);
    expect(result.overwritten).toEqual([]);

    const m = await loadManifest(manifestPath);
    expect(m.data.secrets.GITHUB_TOKEN).toBe("keychain://github_token");
    expect(await provider.get("github_token")).toBe("ghtok");
  });

  it("respects pathPrefix", async () => {
    const dir = tmpdirpath();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "X=1\n");
    const manifestPath = join(dir, "m.json");
    const resolver = createResolver([memoryProvider("keychain")]);

    await secretImport({
      manifestPath,
      resolver,
      envFile,
      backend: "keychain",
      pathPrefix: "myapp/",
    });

    const m = await loadManifest(manifestPath);
    expect(m.data.secrets.X).toBe("keychain://myapp/x");
  });

  it("skips existing by default", async () => {
    const dir = tmpdirpath();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "X=new\n");
    const manifestPath = join(dir, "m.json");
    const provider = memoryProvider("keychain");
    const resolver = createResolver([provider]);

    await secretImport({ manifestPath, resolver, envFile, backend: "keychain" });
    const r2 = await secretImport({ manifestPath, resolver, envFile, backend: "keychain" });

    expect(r2.skipped).toEqual(["X"]);
    expect(r2.added).toEqual([]);
  });

  it("overwrites with --force", async () => {
    const dir = tmpdirpath();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "X=v1\n");
    const manifestPath = join(dir, "m.json");
    const provider = memoryProvider("keychain");
    const resolver = createResolver([provider]);

    await secretImport({ manifestPath, resolver, envFile, backend: "keychain" });
    writeFileSync(envFile, "X=v2\n");
    const r2 = await secretImport({
      manifestPath,
      resolver,
      envFile,
      backend: "keychain",
      force: true,
    });

    expect(r2.overwritten).toEqual(["X"]);
    expect(await provider.get("x")).toBe("v2");
  });
});

describe("secretExport", () => {
  it("env format without values", async () => {
    const dir = tmpdirpath();
    const manifestPath = join(dir, "m.json");
    const resolver = createResolver([memoryProvider("keychain")]);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        secrets: { GH: "keychain://gh", AWS: "keychain://aws" },
        autoInject: { enabled: true, prefix: "DURU_" },
        oauth: { provider: "file", targets: {} },
      }),
    );

    const out = await secretExport({ manifestPath, resolver, format: "env" });
    expect(out).toContain("# AWS → keychain://aws");
    expect(out).toContain("# GH → keychain://gh");
  });

  it("env format with values", async () => {
    const dir = tmpdirpath();
    const manifestPath = join(dir, "m.json");
    const provider = memoryProvider("keychain");
    const resolver = createResolver([provider]);
    await provider.set("gh", "ghtok");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        secrets: { GH: "keychain://gh" },
        autoInject: { enabled: true, prefix: "DURU_" },
        oauth: { provider: "file", targets: {} },
      }),
    );

    const out = await secretExport({
      manifestPath,
      resolver,
      format: "env",
      withValues: true,
    });
    expect(out).toContain('GH="ghtok"');
  });

  it("json format with values", async () => {
    const dir = tmpdirpath();
    const manifestPath = join(dir, "m.json");
    const provider = memoryProvider("keychain");
    const resolver = createResolver([provider]);
    await provider.set("gh", "ghtok");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        secrets: { GH: "keychain://gh" },
        autoInject: { enabled: true, prefix: "DURU_" },
        oauth: { provider: "file", targets: {} },
      }),
    );

    const out = await secretExport({
      manifestPath,
      resolver,
      format: "json",
      withValues: true,
    });
    expect(JSON.parse(out)).toEqual({ GH: "ghtok" });
  });
});

// Suppress unused import warning in node test runner
void readFileSync;
