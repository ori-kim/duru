import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeychainIndex } from "./index-file.ts";

const tmpDirs: string[] = [];
function tmpPath(): string {
  const d = mkdtempSync(join(tmpdir(), "kc-idx-"));
  tmpDirs.push(d);
  return join(d, "index.json");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("keychain index", () => {
  it("starts empty for missing file", async () => {
    const idx = createKeychainIndex(tmpPath());
    expect(await idx.list()).toEqual([]);
  });

  it("add+list roundtrip", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.add("gh/TOKEN");
    await idx.add("aws/KEY");
    expect((await idx.list()).sort()).toEqual(["aws/KEY", "gh/TOKEN"]);
  });

  it("add is idempotent", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.add("x");
    await idx.add("x");
    expect(await idx.list()).toEqual(["x"]);
  });

  it("remove non-existent is no-op", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.remove("missing");
    expect(await idx.list()).toEqual([]);
  });

  it("remove existing removes from list", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.add("a");
    await idx.add("b");
    await idx.remove("a");
    expect(await idx.list()).toEqual(["b"]);
  });

  it("list with prefix filter", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.add("gh/a");
    await idx.add("gh/b");
    await idx.add("aws/c");
    expect((await idx.list("gh/")).sort()).toEqual(["gh/a", "gh/b"]);
  });

  it("persists across instances", async () => {
    const p = tmpPath();
    const a = createKeychainIndex(p);
    await a.add("persistent");
    const b = createKeychainIndex(p);
    expect(await b.list()).toEqual(["persistent"]);
  });

  it("rebuild replaces with given list", async () => {
    const idx = createKeychainIndex(tmpPath());
    await idx.add("old");
    await idx.rebuild(["new1", "new2"]);
    expect((await idx.list()).sort()).toEqual(["new1", "new2"]);
  });

  it("creates parent dir on first write", async () => {
    const d = mkdtempSync(join(tmpdir(), "kc-idx-deep-"));
    tmpDirs.push(d);
    const path = join(d, "nested", "subdir", "index.json");
    const idx = createKeychainIndex(path);
    await idx.add("created");
    expect(await idx.list()).toEqual(["created"]);
  });
});
