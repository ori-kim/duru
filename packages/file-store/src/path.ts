import { isAbsolute, relative, resolve } from "node:path";
import { ClipFileStorePathError } from "./errors";

export function assertSafeStorePath(path: string): void {
  if (!path) throw new ClipFileStorePathError(path, "path must not be empty");
  if (isAbsolute(path)) throw new ClipFileStorePathError(path, "absolute paths are not allowed");
  if (/^[A-Za-z]:[\\/]/.test(path)) throw new ClipFileStorePathError(path, "absolute paths are not allowed");
  for (const segment of path.split(/[\\/]/)) {
    if (!segment) throw new ClipFileStorePathError(path, "empty path segments are not allowed");
    if (segment === "." || segment === "..") {
      throw new ClipFileStorePathError(path, "relative dot segments are not allowed");
    }
  }
}

export function resolveStorePath(root: string, path?: string): string {
  if (!path) return root;
  assertSafeStorePath(path);
  const resolved = resolve(root, path);
  const offset = relative(root, resolved);
  if (offset.startsWith("..") || offset === ".." || isAbsolute(offset)) {
    throw new ClipFileStorePathError(path, "path escapes store root");
  }
  return resolved;
}

export function safeJoin(base: string | undefined, name: string): string {
  return base ? `${base.replace(/[\\/]+$/, "")}/${name}` : name;
}
