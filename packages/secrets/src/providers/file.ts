import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseDotenv } from "../dotenv.ts";
import { NotSupportedError, PermissionDenied } from "../errors.ts";
import { acquireFileLock } from "../file-lock.ts";
import type { SecretProvider } from "../provider.ts";

export interface FileProviderOptions {
  /** Base directory for relative paths. Default: $DURU_HOME/secrets. */
  baseDir?: string;
}

function defaultBaseDir(): string {
  const home = process.env.DURU_HOME ?? join(process.env.HOME ?? ".", ".duru");
  return join(home, "secrets");
}

type ResolvedPath = { absPath: string; key?: string; managed: boolean };

const HIDDEN_OR_SIDECAR_RE = /^\.|\.(tmp|lock)$/;

/**
 * file:// provider with two modes:
 *  - Absolute path (`file:///abs/path/file#KEY`): read-only .env migration source.
 *    `#KEY` selects a dotenv entry. set/delete throw NotSupportedError.
 *  - Relative path (`file://oauth/gh/token`): managed under `baseDir`
 *    ($DURU_HOME/secrets by default). One file per ref. Full read/write/list.
 *    Path traversal (`..` escapes) is rejected.
 */
export class FileProvider implements SecretProvider {
  readonly scheme = "file";
  private readonly baseDir: string;
  private readonly baseDirResolved: string;

  constructor(opts: FileProviderOptions = {}) {
    this.baseDir = opts.baseDir ?? defaultBaseDir();
    this.baseDirResolved = resolve(this.baseDir);
  }

  private resolvePath(path: string): ResolvedPath {
    if (path.length === 0) {
      throw new NotSupportedError(this.scheme, "empty path");
    }
    const hashIdx = path.indexOf("#");
    const rawPath = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
    const key = hashIdx >= 0 ? path.slice(hashIdx + 1) : undefined;
    if (rawPath.length === 0) {
      throw new NotSupportedError(this.scheme, "empty path before fragment");
    }

    if (isAbsolute(rawPath)) {
      return { absPath: rawPath, key, managed: false };
    }
    const joined = join(this.baseDir, rawPath);
    const resolved = resolve(joined);
    // Reject any path that escapes baseDir via `..` or symlink-like normalisation.
    if (!(resolved === this.baseDirResolved || resolved.startsWith(`${this.baseDirResolved}${sep}`))) {
      throw new PermissionDenied(path, `path escapes managed directory (resolved to ${resolved})`);
    }
    return { absPath: resolved, key, managed: true };
  }

  async get(path: string): Promise<string | undefined> {
    const { absPath, key } = this.resolvePath(path);
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    if (!key) return raw;
    return parseDotenv(raw).get(key);
  }

  async set(path: string, value: string): Promise<void> {
    const { absPath, key, managed } = this.resolvePath(path);
    if (!managed) {
      throw new NotSupportedError(this.scheme, "set on absolute path (only managed relative paths are writable)");
    }
    if (key !== undefined) {
      throw new NotSupportedError(this.scheme, "set with #key fragment (dotenv key writes are lossy)");
    }
    // Ensure parent dir exists before lock (acquireFileLock opens `.lock` with O_EXCL).
    await mkdir(dirname(absPath), { recursive: true });
    // Per-path lock so concurrent set/delete on the same ref serialise.
    const release = await acquireFileLock(absPath);
    try {
      // Unique tmp suffix so two writers racing the lock acquisition don't collide.
      const tmp = `${absPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, value, { mode: 0o600 });
      await rename(tmp, absPath);
    } finally {
      await release();
    }
  }

  async delete(path: string): Promise<void> {
    const { absPath, key, managed } = this.resolvePath(path);
    if (!managed) {
      throw new NotSupportedError(this.scheme, "delete on absolute path (only managed relative paths are writable)");
    }
    if (key !== undefined) {
      throw new NotSupportedError(this.scheme, "delete with #key fragment");
    }
    // mkdir for parent so acquireFileLock can create its sidecar even when target doesn't exist.
    await mkdir(dirname(absPath), { recursive: true });
    const release = await acquireFileLock(absPath);
    try {
      await rm(absPath, { force: true });
    } finally {
      await release();
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const results: string[] = [];
    try {
      await walk(this.baseDir, "", results);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return prefix ? results.filter((r) => r.startsWith(prefix)) : results;
  }
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    // Skip dotfiles, .tmp work files, .lock files (file-lock sidecars).
    if (HIDDEN_OR_SIDECAR_RE.test(e.name)) continue;
    const child = join(dir, e.name);
    const relChild = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walk(child, relChild, out);
    } else if (e.isFile()) {
      out.push(relChild);
    }
  }
}
