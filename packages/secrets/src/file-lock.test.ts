import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireFileLock } from "./file-lock.ts";

const tmpDirs: string[] = [];
function tmpPath(): string {
  const d = mkdtempSync(join(tmpdir(), "duru-lock-"));
  tmpDirs.push(d);
  return join(d, "target.json");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("acquireFileLock", () => {
  it("acquires lock when none exists", async () => {
    const release = await acquireFileLock(tmpPath());
    await release();
  });

  it("second acquire blocks until first releases", async () => {
    const path = tmpPath();
    const r1 = await acquireFileLock(path);
    let acquired = false;
    const second = acquireFileLock(path, { retryIntervalMs: 10, timeoutMs: 1000 }).then((r) => {
      acquired = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(acquired).toBe(false);
    await r1();
    const r2 = await second;
    expect(acquired).toBe(true);
    await r2();
  });

  it("times out if lock not released", async () => {
    const path = tmpPath();
    await acquireFileLock(path);
    await expect(acquireFileLock(path, { retryIntervalMs: 10, timeoutMs: 100 })).rejects.toThrow(
      /Could not acquire lock/,
    );
  });

  it("removes stale lock and acquires", async () => {
    const path = tmpPath();
    // Manually create a stale lock file (mtime in past)
    const lockPath = `${path}.lock`;
    writeFileSync(lockPath, "stale\n");
    const now = Date.now();
    const past = new Date(now - 100_000);
    const fs = await import("node:fs/promises");
    await fs.utimes(lockPath, past, past);

    const release = await acquireFileLock(path, {
      staleMs: 50_000,
      timeoutMs: 500,
    });
    await release();
  });

  it("double release is safe", async () => {
    const release = await acquireFileLock(tmpPath());
    await release();
    await release(); // no throw
  });
});
