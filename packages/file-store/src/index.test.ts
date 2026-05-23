import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ClipFileStoreCodecError,
  ClipFileStoreParseError,
  ClipFileStorePathError,
  assertSafeStorePath,
  createClipFileHome,
  createFileStore,
  jsonCodec,
  tomlCodec,
  yamlCodec,
} from "@clip/file-store";

describe("@clip/file-store", () => {
  test("resolves home from explicit option, CLIP_HOME, then defaultHome", async () => {
    const explicitHome = await tempDir("explicit");
    const envHome = await tempDir("env");
    const defaultHome = await tempDir("default");

    expect(createClipFileHome({ home: explicitHome, env: { CLIP_HOME: envHome }, defaultHome }).root).toBe(
      resolve(explicitHome),
    );
    expect(createClipFileHome({ env: { CLIP_HOME: envHome }, defaultHome }).root).toBe(resolve(envHome));
    expect(createClipFileHome({ env: {}, defaultHome }).root).toBe(resolve(defaultHome));
  });

  test("creates scoped stores while rejecting unsafe relative paths", async () => {
    const root = await tempDir("paths");
    const home = createClipFileHome({ home: root });
    const targetFiles = home.store("target").scope("cli");

    expect(targetFiles.root).toBe(resolve(root, "target", "cli"));
    expect(targetFiles.resolve("test-service/config.yml")).toBe(
      resolve(root, "target", "cli", "test-service", "config.yml"),
    );
    expect(() => assertSafeStorePath("../config.yml")).toThrow(ClipFileStorePathError);
    expect(() => targetFiles.resolve("/tmp/config.yml")).toThrow(ClipFileStorePathError);
    expect(() => assertSafeStorePath("C:\\temp\\config.yml")).toThrow(ClipFileStorePathError);
    expect(() => targetFiles.scope("bad/../name")).toThrow(ClipFileStorePathError);
  });

  test("reads, writes, lists, and removes text and binary files", async () => {
    const store = createFileStore({ root: await tempDir("plain") });

    expect(await store.readText("notes/missing.txt")).toBeUndefined();
    await store.writeText("notes/example.txt", "hello");
    await store.writeBytes("bin/data.bin", new Uint8Array([1, 2, 3]));

    expect(await store.readText("notes/example.txt")).toBe("hello");
    const bytes = await store.readBytes("bin/data.bin");
    expect(bytes).toBeDefined();
    expect(bytes ? [...bytes] : []).toEqual([1, 2, 3]);
    expect(await store.exists("notes/example.txt")).toBe(true);
    expect(await store.list("notes")).toEqual([
      { name: "example.txt", path: "notes/example.txt", type: "file", isFile: true, isDirectory: false },
    ]);

    await store.remove("notes/example.txt");
    expect(await store.exists("notes/example.txt")).toBe(false);
  });

  test("round trips JSON, YAML, and TOML through extension based codecs", async () => {
    const store = codecStore(await tempDir("structured"));
    const value = {
      name: "test-service",
      enabled: true,
      timeoutMs: 30000,
      tags: ["alpha", "beta"],
      endpoint: {
        url: "https://api.example.com",
      },
    };

    await store.write("configs/service.json", value);
    await store.write("configs/service.yml", value);
    await store.write("configs/service.toml", value);

    expect(await store.read<typeof value>("configs/service.json")).toEqual(value);
    expect(await store.read<typeof value>("configs/service.yml")).toEqual(value);
    expect(await store.read<typeof value>("configs/service.toml")).toEqual(value);
  });

  test("can use explicit codec ids independent of file extension", async () => {
    const store = codecStore(await tempDir("explicit-codec"));
    const value = { name: "catservice", timeoutMs: 1000 };

    await store.writeAs("targets/catservice", value, "json");

    expect(await store.readAs<typeof value>("targets/catservice", "json")).toEqual(value);
    expect(await readFile(store.resolve("targets/catservice"), "utf8")).toContain('"catservice"');
  });

  test("reports codec and parse failures with typed errors", async () => {
    const store = codecStore(await tempDir("errors"));

    await expect(store.write("config.unknown", { name: "example" })).rejects.toThrow(ClipFileStoreCodecError);
    await writeFile(store.resolve("bad.json"), "{");

    await expect(store.read("bad.json")).rejects.toThrow(ClipFileStoreParseError);
  });
});

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `clip-file-store-${label}-`));
}

function codecStore(root: string) {
  return createFileStore({ root, codecs: [jsonCodec(), yamlCodec(), tomlCodec()] });
}
