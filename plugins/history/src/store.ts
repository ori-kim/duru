import type { FileStore } from "@duru/file-store";
import type { HistoryListOptions, HistoryRecord } from "./types.ts";

const FILE_EXT = ".jsonl";
const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type HistoryStore = {
  append(record: Omit<HistoryRecord, "id"> & { id?: string }): Promise<HistoryRecord>;
  list(options?: HistoryListOptions): Promise<readonly HistoryRecord[]>;
  get(id: string): Promise<HistoryRecord | undefined>;
  clearBefore(date: string): Promise<number>;
};

export function dateKey(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fileNameFor(date: string): string {
  return `${date}${FILE_EXT}`;
}

export function makeId(date: string, seq: number): string {
  return `${date}#${String(seq).padStart(4, "0")}`;
}

function parseLine(line: string): HistoryRecord | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const value = JSON.parse(trimmed) as HistoryRecord;
    return value && typeof value.id === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function serializeRecord(record: HistoryRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function createHistoryStore(files: FileStore): HistoryStore {
  async function readFile(name: string): Promise<HistoryRecord[]> {
    const text = await files.readText(name);
    if (!text) return [];
    const out: HistoryRecord[] = [];
    for (const line of text.split("\n")) {
      const rec = parseLine(line);
      if (rec) out.push(rec);
    }
    return out;
  }

  async function listFiles(): Promise<string[]> {
    const entries = await files.list();
    return entries
      .filter((e) => e.isFile && DATE_FILE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  async function nextSeq(date: string): Promise<number> {
    const name = fileNameFor(date);
    if (!(await files.exists(name))) return 1;
    const records = await readFile(name);
    return records.length + 1;
  }

  return {
    async append(input) {
      await files.ensureDir();
      const at = new Date(input.at);
      const date = dateKey(Number.isNaN(at.valueOf()) ? new Date() : at);
      const seq = await nextSeq(date);
      const record: HistoryRecord = {
        id: input.id ?? makeId(date, seq),
        at: input.at,
        argv: input.argv,
        cwd: input.cwd,
        status: input.status,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
      };
      const name = fileNameFor(date);
      const prev = (await files.readText(name)) ?? "";
      await files.writeText(name, prev + serializeRecord(record));
      return record;
    },

    async list(options = {}) {
      const limit = options.limit ?? 50;
      const since = options.since;
      const grep = options.grep?.toLowerCase();
      const errorsOnly = options.errorsOnly === true;

      const fileNames = await listFiles();
      const filtered = since ? fileNames.filter((n) => n.replace(FILE_EXT, "") >= since) : fileNames;

      const out: HistoryRecord[] = [];
      for (let i = filtered.length - 1; i >= 0; i--) {
        const records = await readFile(filtered[i]);
        for (let j = records.length - 1; j >= 0; j--) {
          const rec = records[j];
          if (errorsOnly && rec.status === "ok") continue;
          if (grep && !rec.argv.join(" ").toLowerCase().includes(grep)) continue;
          out.push(rec);
          if (out.length >= limit) return out;
        }
      }
      return out;
    },

    async get(id) {
      const date = id.split("#")[0];
      if (!date) return undefined;
      const records = await readFile(fileNameFor(date));
      return records.find((r) => r.id === id);
    },

    async clearBefore(date) {
      const fileNames = await listFiles();
      let removed = 0;
      for (const name of fileNames) {
        const fileDate = name.replace(FILE_EXT, "");
        if (fileDate < date) {
          await files.remove(name);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
