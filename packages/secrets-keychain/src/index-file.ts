import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireFileLock } from "@duru/secrets";

export interface KeychainIndex {
  list(prefix?: string): Promise<string[]>;
  add(account: string): Promise<void>;
  remove(account: string): Promise<void>;
  rebuild(accounts: readonly string[]): Promise<void>;
}

export function createKeychainIndex(path: string): KeychainIndex {
  async function read(): Promise<Set<string>> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as { accounts?: string[] };
      return new Set(parsed.accounts ?? []);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw err;
    }
  }
  async function write(set: Set<string>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const data = { accounts: [...set].sort() };
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  }
  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(dirname(path), { recursive: true });
    const release = await acquireFileLock(path);
    try {
      return await fn();
    } finally {
      await release();
    }
  }
  return {
    async list(prefix) {
      const all = [...(await read())];
      return prefix ? all.filter((a) => a.startsWith(prefix)) : all;
    },
    add(account) {
      return withLock(async () => {
        const set = await read();
        set.add(account);
        await write(set);
      });
    },
    remove(account) {
      return withLock(async () => {
        const set = await read();
        set.delete(account);
        await write(set);
      });
    },
    rebuild(accounts) {
      return withLock(async () => {
        await write(new Set(accounts));
      });
    },
  };
}
