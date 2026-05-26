import { basename } from "node:path";
import { createQmdClient } from "@duru/qmd";
import type { QmdClient, QmdSearchResult } from "@duru/qmd";
import type { MemoryStore } from "./store.ts";

export type MemoryQmdClient = QmdClient;
export type MemoryQmdSearchResult = QmdSearchResult;

export const MEMORY_COLLECTION = "memory";
export const MEMORY_GLOB = "items/**/*.md";
export const QMD_INSTALL_MSG = "qmd is not available. Install @tobilu/qmd or ensure qmd is on PATH.";

export { createQmdClient };

export async function ensureMemoryCollection(qmd: MemoryQmdClient, store: MemoryStore): Promise<void> {
  await qmd.ensureCollection(MEMORY_COLLECTION, store.memoryDir, MEMORY_GLOB);
}

export async function reindexMemory(qmd: MemoryQmdClient, store: MemoryStore): Promise<void> {
  await ensureMemoryCollection(qmd, store);
  await qmd.update();
  await qmd.embed(MEMORY_COLLECTION);
}

export async function tryReindexMemory(qmd: MemoryQmdClient, store: MemoryStore): Promise<boolean> {
  if (!(await qmd.isAvailable())) return false;
  await reindexMemory(qmd, store);
  return true;
}

export async function reindexMemoryInBackground(qmd: MemoryQmdClient, store: MemoryStore): Promise<void> {
  await ensureMemoryCollection(qmd, store);
  await qmd.reindexInBackground(MEMORY_COLLECTION);
}

export function memoryIdFromSearchResult(result: MemoryQmdSearchResult): string {
  return basename(result.name).replace(/\.md$/i, "");
}
