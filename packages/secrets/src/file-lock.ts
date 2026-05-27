import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_OPTS = {
  retryIntervalMs: 50,
  timeoutMs: 5_000,
  staleMs: 30_000,
};

export type LockOptions = Partial<typeof DEFAULT_OPTS>;

/**
 * Acquire an advisory file lock by creating `<path>.lock` exclusively (O_EXCL).
 * Retries until acquired or timeout. Lock files older than staleMs are treated
 * as orphaned and removed.
 *
 * Returns a release function that must be called in a finally block.
 *
 * This is best-effort cooperative locking — not a kernel-enforced mutex.
 * All callers must use this lock for it to be effective.
 */
export async function acquireFileLock(path: string, opts: LockOptions = {}): Promise<() => Promise<void>> {
  const merged = { ...DEFAULT_OPTS, ...opts };
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + merged.timeoutMs;

  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      // O_EXCL: fail if exists. mode 0o600 = owner read/write only.
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await rm(lockPath, { force: true });
        } catch {
          // best effort — another release may have already removed
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // existing lock — check if stale
      if (await isStale(lockPath, merged.staleMs)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Could not acquire lock on ${path} within ${merged.timeoutMs}ms (lock file: ${lockPath})`);
      }
      await sleep(merged.retryIntervalMs);
    }
  }
}

async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const handle = await open(lockPath, "r");
    try {
      const stat = await handle.stat();
      return Date.now() - stat.mtime.getTime() > staleMs;
    } finally {
      await handle.close();
    }
  } catch {
    // lock disappeared between EEXIST and stat
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
