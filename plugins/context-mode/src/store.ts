import type { FileStore } from "@duru/file-store";
import type { CaptureRecord, ContextState } from "./types.ts";

const stateFile = "state.json";
const maxCaptures = 100;
const emptyState: ContextState = { nextId: 1, captures: [] };

export type ContextStore = {
  append(record: Omit<CaptureRecord, "id">): Promise<void>;
  list(): Promise<readonly CaptureRecord[]>;
  search(query: string): Promise<readonly CaptureRecord[]>;
};

export function createContextStore(files: FileStore): ContextStore {
  async function readState(): Promise<ContextState> {
    return (await files.read<ContextState>(stateFile)) ?? emptyState;
  }

  async function append(record: Omit<CaptureRecord, "id">): Promise<void> {
    await files.ensureDir();
    const state = await readState();
    const id = String(state.nextId);
    const captures = [...state.captures, { ...record, id }].slice(-maxCaptures);
    await files.write(stateFile, { nextId: state.nextId + 1, captures });
  }

  async function list(): Promise<readonly CaptureRecord[]> {
    return (await readState()).captures;
  }

  async function search(query: string): Promise<readonly CaptureRecord[]> {
    const captures = await list();
    const normalized = query.trim().toLowerCase();
    if (!normalized) return captures;
    return captures.filter(
      (c) =>
        c.argv.join(" ").toLowerCase().includes(normalized) || (c.text?.toLowerCase().includes(normalized) ?? false),
    );
  }

  return { append, list, search };
}
