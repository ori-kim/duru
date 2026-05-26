import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotSupportedError, PermissionDenied } from "../errors.ts";
import { FileProvider } from "./file.ts";

const tmpDirs: string[] = [];
function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "duru-secrets-file-"));
  tmpDirs.push(dir);
  const path = join(dir, "secrets.env");
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}
function tmpBaseDir(): string {
  const d = mkdtempSync(join(tmpdir(), "duru-secrets-base-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FileProvider — absolute path (read-only .env source)", () => {
  it("scheme is 'file'", () => {
    expect(new FileProvider().scheme).toBe("file");
  });

  it("returns file content for absolute path without fragment", async () => {
    const p = tmpFile("hello");
    const provider = new FileProvider();
    expect(await provider.get(p)).toBe("hello");
  });

  it("returns specific key when fragment present", async () => {
    const p = tmpFile("FOO=bar\nBAZ=qux\n");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("bar");
    expect(await provider.get(`${p}#BAZ`)).toBe("qux");
  });

  it("returns undefined for missing key", async () => {
    const p = tmpFile("FOO=bar");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#MISSING`)).toBeUndefined();
  });

  it("returns undefined for missing file", async () => {
    const provider = new FileProvider();
    expect(await provider.get("/nonexistent/path#KEY")).toBeUndefined();
  });

  it("supports double-quoted values with escapes", async () => {
    const p = tmpFile('FOO="hello\\nworld"\n');
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("hello\nworld");
  });

  it("supports single-quoted values (no escapes)", async () => {
    const p = tmpFile("FOO='raw\\nstring'\n");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("raw\\nstring");
  });

  it("ignores comments and blank lines", async () => {
    const p = tmpFile("# comment\n\nFOO=bar\n");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("bar");
  });

  it("supports export prefix", async () => {
    const p = tmpFile("export FOO=bar\n");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("bar");
  });

  it("strips trailing inline comments", async () => {
    const p = tmpFile("FOO=bar # comment\n");
    const provider = new FileProvider();
    expect(await provider.get(`${p}#FOO`)).toBe("bar");
  });

  it("rejects set on absolute path", async () => {
    const provider = new FileProvider();
    await expect(provider.set("/tmp/x", "v")).rejects.toThrow(NotSupportedError);
  });

  it("rejects delete on absolute path", async () => {
    const provider = new FileProvider();
    await expect(provider.delete("/tmp/x")).rejects.toThrow(NotSupportedError);
  });
});

describe("FileProvider — relative path (managed under baseDir)", () => {
  it("set + get roundtrip in managed dir", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("oauth/gh/token", "ghtok");
    expect(await provider.get("oauth/gh/token")).toBe("ghtok");
    expect(existsSync(join(base, "oauth/gh/token"))).toBe(true);
  });

  it("creates intermediate directories", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("a/b/c/d/key", "v");
    expect(readFileSync(join(base, "a/b/c/d/key"), "utf8")).toBe("v");
  });

  it("writes with 0o600 mode", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("perms-test", "v");
    const stat = statSync(join(base, "perms-test"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("delete removes managed file", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("x", "v");
    await provider.delete("x");
    expect(existsSync(join(base, "x"))).toBe(false);
  });

  it("delete missing is no-op", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await provider.delete("nonexistent");
  });

  it("rejects set with fragment in relative path", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.set("file#KEY", "v")).rejects.toThrow(NotSupportedError);
  });

  it("get returns undefined for missing relative file", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    expect(await provider.get("missing/key")).toBeUndefined();
  });

  it("list walks baseDir recursively", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("a", "1");
    await provider.set("nested/b", "2");
    await provider.set("nested/deep/c", "3");
    expect((await provider.list()).sort()).toEqual(["a", "nested/b", "nested/deep/c"]);
  });

  it("list with prefix filter", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    await provider.set("oauth/gh/t", "1");
    await provider.set("oauth/slack/t", "2");
    await provider.set("api/k", "3");
    expect((await provider.list("oauth/")).sort()).toEqual(["oauth/gh/t", "oauth/slack/t"]);
  });

  it("list returns empty when baseDir missing", async () => {
    const provider = new FileProvider({ baseDir: join(tmpBaseDir(), "no-such-dir") });
    expect(await provider.list()).toEqual([]);
  });

  it("list ignores .tmp, .lock, and dotfiles", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    writeFileSync(join(base, "real"), "v");
    writeFileSync(join(base, "orphan.tmp"), "leftover");
    writeFileSync(join(base, "real.lock"), "lock");
    writeFileSync(join(base, ".DS_Store"), "mac");
    writeFileSync(join(base, ".hidden"), "h");
    expect((await provider.list()).sort()).toEqual(["real"]);
  });
});

describe("FileProvider — path traversal protection", () => {
  it("rejects ../ in relative path on set", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.set("../escaped", "PWNED")).rejects.toThrow(PermissionDenied);
  });

  it("rejects deep ../ traversal on set", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.set("../../../tmp/pwned", "PWNED")).rejects.toThrow(PermissionDenied);
  });

  it("rejects ../ in relative path on get", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.get("../etc/passwd")).rejects.toThrow(PermissionDenied);
  });

  it("rejects ../ in relative path on delete", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.delete("../escaped")).rejects.toThrow(PermissionDenied);
  });

  it("accepts paths that normalise inside baseDir", async () => {
    const base = tmpBaseDir();
    const provider = new FileProvider({ baseDir: base });
    // a/b/../c normalises to a/c — stays inside baseDir
    await provider.set("a/b/../c", "ok");
    expect(await provider.get("a/c")).toBe("ok");
  });

  it("rejects empty path", async () => {
    const provider = new FileProvider({ baseDir: tmpBaseDir() });
    await expect(provider.set("", "v")).rejects.toThrow(NotSupportedError);
  });
});
