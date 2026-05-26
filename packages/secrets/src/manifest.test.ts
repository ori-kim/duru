import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidReference } from "./errors.ts";
import {
  type Manifest,
  type ManifestData,
  emptyManifest,
  loadManifest,
  saveManifest,
  validateManifestData,
} from "./manifest.ts";

const tmpDirs: string[] = [];
function tmpJson(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "duru-manifest-"));
  tmpDirs.push(dir);
  const path = join(dir, "manifest.json");
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("emptyManifest", () => {
  it("returns default structure", () => {
    expect(emptyManifest()).toEqual({
      secrets: {},
      autoInject: { enabled: true, prefix: "DURU_" },
      extensions: {},
    } satisfies ManifestData);
  });
});

describe("loadManifest", () => {
  it("loads existing file", async () => {
    const p = tmpJson({
      secrets: { GH: "keychain://gh/t" },
      autoInject: { enabled: true, prefix: "DURU_" },
      extensions: {},
    });
    const m = await loadManifest(p);
    expect(m.data.secrets.GH).toBe("keychain://gh/t");
    expect(m.path).toBe(p);
  });

  it("returns empty for missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duru-missing-"));
    tmpDirs.push(dir);
    const m = await loadManifest(join(dir, "absent.json"));
    expect(m.data).toEqual(emptyManifest());
  });

  it("rejects reserved-prefix secret name when caller registers prefix", async () => {
    const p = tmpJson({
      secrets: { "oauth/x": "keychain://y" },
      autoInject: { enabled: true, prefix: "DURU_" },
      extensions: {},
    });
    await expect(loadManifest(p, { reservedPrefixes: ["oauth/"] })).rejects.toThrow(/reserved prefix/);
  });

  it("accepts reserved-prefix name when caller registers no prefixes", async () => {
    const p = tmpJson({
      secrets: { "oauth/x": "keychain://y" },
      autoInject: { enabled: true, prefix: "DURU_" },
      extensions: {},
    });
    const m = await loadManifest(p);
    expect(m.data.secrets["oauth/x"]).toBe("keychain://y");
  });

  it("rejects invalid ref syntax", async () => {
    const p = tmpJson({
      secrets: { GOOD: "keychain://x", BAD: "javascript:alert(1)" },
      autoInject: { enabled: true, prefix: "DURU_" },
      extensions: {},
    });
    await expect(loadManifest(p)).rejects.toThrow(InvalidReference);
  });
});

describe("saveManifest", () => {
  it("atomic write to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duru-save-"));
    tmpDirs.push(dir);
    const path = join(dir, "m.json");
    const m: Manifest = {
      path,
      data: { ...emptyManifest(), secrets: { X: "keychain://x" } },
    };
    await saveManifest(m);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(m.data);
  });

  it("validates reserved prefix before writing when caller registers prefixes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duru-save-"));
    tmpDirs.push(dir);
    const path = join(dir, "m.json");
    const m: Manifest = {
      path,
      data: { ...emptyManifest(), secrets: { "oauth/x": "keychain://x" } },
    };
    await expect(saveManifest(m, { reservedPrefixes: ["oauth/"] })).rejects.toThrow(/reserved prefix/);
  });
});

describe("validateManifestData", () => {
  it("accepts well-formed", () => {
    expect(() => validateManifestData(emptyManifest())).not.toThrow();
  });

  it("rejects non-object", () => {
    expect(() => validateManifestData(null)).toThrow();
  });

  it("accepts arbitrary extensions content (opaque to core)", () => {
    expect(() =>
      validateManifestData({
        secrets: {},
        autoInject: { enabled: true, prefix: "DURU_" },
        extensions: { oauth: { whatever: "shape" }, custom: 42 },
      }),
    ).not.toThrow();
  });

  it("rejects non-object extensions", () => {
    expect(() =>
      validateManifestData({
        secrets: {},
        autoInject: { enabled: true, prefix: "DURU_" },
        extensions: "not-an-object",
      }),
    ).toThrow();
  });

  it("rejects missing autoInject", () => {
    expect(() =>
      validateManifestData({
        secrets: {},
        extensions: {},
      }),
    ).toThrow();
  });

  it("rejects invalid secret name (special chars)", () => {
    expect(() =>
      validateManifestData({
        secrets: { "bad!name": "keychain://x" },
        autoInject: { enabled: true, prefix: "DURU_" },
        extensions: {},
      }),
    ).toThrow();
  });
});
