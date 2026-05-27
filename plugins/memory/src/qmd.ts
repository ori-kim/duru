import { basename } from "node:path";
import { QMD_SEMANTIC_INSTALL_MSG, createQmdClient } from "@duru/qmd";
import type { QmdClient, QmdModelStatus, QmdSearchResult } from "@duru/qmd";
import type { MemoryStore } from "./store.ts";

export type MemoryQmdClient = QmdClient;
export type MemoryQmdSearchResult = QmdSearchResult;
export type MemorySemanticStatus = QmdModelStatus;

export const MEMORY_COLLECTION = "memory";
export const MEMORY_GLOB = "items/**/*.md";
export const QMD_INSTALL_MSG = "qmd runtime is not available. Ensure @tobilu/qmd is installed.";

export { QMD_SEMANTIC_INSTALL_MSG, createQmdClient };

export async function ensureMemoryCollection(qmd: MemoryQmdClient, store: MemoryStore): Promise<void> {
  await qmd.ensureCollection(MEMORY_COLLECTION, store.memoryDir, MEMORY_GLOB);
}

export async function reindexMemory(
  qmd: MemoryQmdClient,
  store: MemoryStore,
  options: { vector?: boolean } = {},
): Promise<void> {
  await ensureMemoryCollection(qmd, store);
  await qmd.update();
  if (options.vector === true) await qmd.embed(MEMORY_COLLECTION);
}

export async function tryReindexMemory(qmd: MemoryQmdClient, store: MemoryStore): Promise<boolean> {
  if (!(await qmd.isAvailable())) return false;
  await reindexMemory(qmd, store);
  return true;
}

export async function reindexMemoryInBackground(qmd: MemoryQmdClient, store: MemoryStore): Promise<void> {
  await ensureMemoryCollection(qmd, store);
  await qmd.reindexInBackground(MEMORY_COLLECTION, { vector: "if-installed" });
}

export function memoryIdFromSearchResult(result: MemoryQmdSearchResult): string {
  return basename(result.name).replace(/\.md$/i, "");
}
