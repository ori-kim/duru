import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codecById, codecByPath, codecRegistry, defaultCodecs } from "./codecs";
import { ClipFileStoreParseError, ClipFileStoreWriteError } from "./errors";
import { resolveStorePath, safeJoin } from "./path";
import type {
  ClipFileHome,
  CreateClipFileHomeOptions,
  CreateFileStoreOptions,
  FileCodec,
  FileStore,
  ReadStructuredOptions,
  WriteOptions,
} from "./types";

export function createClipFileHome(options: CreateClipFileHomeOptions = {}): ClipFileHome {
  const root = resolve(options.home ?? options.env?.CLIP_HOME ?? options.defaultHome ?? join(homedir(), ".clip"));
  const codecs = options.codecs ?? defaultCodecs();
  return {
    root,
    resolve: (path) => resolveStorePath(root, path),
    scope: (name) => createFileStore({ root: resolveStorePath(root, name), codecs }),
    store: (path) => createFileStore({ root: resolveStorePath(root, path), codecs }),
  };
}

export function createFileStore(options: CreateFileStoreOptions): FileStore {
  const root = resolve(options.root);
  const codecs = options.codecs ?? defaultCodecs();
  const registry = codecRegistry(codecs);

  return {
    root,
    resolve: (path) => resolveStorePath(root, path),
    scope: (name) => createFileStore({ root: resolveStorePath(root, name), codecs }),
    ensureDir: async (path) => {
      await mkdir(resolveStorePath(root, path), { recursive: true });
    },
    exists: async (path) => {
      try {
        await stat(resolveStorePath(root, path));
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    },
    list: async (path) => {
      const dir = resolveStorePath(root, path);
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries
          .map((entry) => {
            const isFile = entry.isFile();
            const isDirectory = entry.isDirectory();
            return {
              name: entry.name,
              path: safeJoin(path, entry.name),
              type: isFile ? "file" : isDirectory ? "directory" : "other",
              isFile,
              isDirectory,
            } as const;
          })
          .sort((left, right) => left.name.localeCompare(right.name));
      } catch (error) {
        if (isNotFoundError(error)) return [];
        throw error;
      }
    },
    readText: async (path) => {
      try {
        return await readFile(resolveStorePath(root, path), "utf8");
      } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
      }
    },
    writeText: async (path, value, options) => {
      await writeStoreFile(resolveStorePath(root, path), value, options);
    },
    readBytes: async (path) => {
      try {
        return await readFile(resolveStorePath(root, path));
      } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
      }
    },
    writeBytes: async (path, value, options) => {
      await writeStoreFile(resolveStorePath(root, path), value, options);
    },
    read: async <T = unknown>(path: string, options?: ReadStructuredOptions): Promise<T | undefined> => {
      const codec = options?.codec ? codecById(registry, options.codec) : codecByPath(registry, path);
      return readStructured<T>(root, path, codec);
    },
    write: async (path, value, options) => {
      const codec = options?.codec ? codecById(registry, options.codec) : codecByPath(registry, path);
      await writeStructured(root, path, value, codec, options);
    },
    readAs: async <T = unknown>(path: string, codec: string): Promise<T | undefined> =>
      readStructured<T>(root, path, codecById(registry, codec)),
    writeAs: async (path, value, codec) => {
      await writeStructured(root, path, value, codecById(registry, codec));
    },
    remove: async (path, options) => {
      await rm(resolveStorePath(root, path), { force: true, recursive: options?.recursive ?? false });
    },
  };
}

async function readStructured<T = unknown>(root: string, path: string, codec: FileCodec): Promise<T | undefined> {
  const resolved = resolveStorePath(root, path);
  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }

  try {
    return codec.parse(text, { path: resolved, codec: codec.id }) as T;
  } catch (error) {
    throw new ClipFileStoreParseError(resolved, codec.id, error);
  }
}

async function writeStructured(
  root: string,
  path: string,
  value: unknown,
  codec: FileCodec,
  options?: WriteOptions,
): Promise<void> {
  const resolved = resolveStorePath(root, path);
  let text: string;
  try {
    text = codec.stringify(value, { path: resolved, codec: codec.id });
  } catch (error) {
    throw new ClipFileStoreWriteError(resolved, error);
  }
  await writeStoreFile(resolved, text, options);
}

async function writeStoreFile(path: string, value: string | Uint8Array, options: WriteOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (options.atomic === false) {
    await writeFile(path, value);
    return;
  }

  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, value);
    await rename(tempPath, path);
  } catch (error) {
    throw new ClipFileStoreWriteError(path, error);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
