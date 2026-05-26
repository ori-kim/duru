import { basename, join } from "node:path";
import type { FileStore } from "@duru/file-store";

export type MemoryMeta = {
  id: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemoryItem = {
  meta: MemoryMeta;
  body: string;
  path: string;
};

export type MemoryUsageRecord = {
  lastAccessedAt: string;
  accessCount: number;
};

export type MemoryUsage = {
  items: Record<string, MemoryUsageRecord>;
};

export type MemoryUsageEvent = {
  action: "show";
  id: string;
  accessedAt: string;
};

export type MemoryConfig = {
  clean?: {
    olderThan?: string;
  };
};

export type MemoryStoreOptions = {
  now?: () => Date;
  timeZone?: string;
};

export type MemoryAddOptions = {
  tags?: readonly string[];
};

export type MemoryTagUpdate = {
  tags?: readonly string[];
  add?: readonly string[];
  remove?: readonly string[];
};

export type MemoryCleanOptions = {
  olderThan?: string;
  dryRun?: boolean;
};

export type MemoryCleanResult = {
  candidates: string[];
  removed: string[];
  invalid: string[];
};

export type MemoryStore = {
  add(body: string, options?: MemoryAddOptions): Promise<MemoryItem>;
  get(id: string): Promise<MemoryItem | null>;
  show(id: string): Promise<MemoryItem | null>;
  updateTags(id: string, update: MemoryTagUpdate): Promise<MemoryItem>;
  delete(id: string): Promise<boolean>;
  clean(options?: MemoryCleanOptions): Promise<MemoryCleanResult>;
  usage(): Promise<MemoryUsage>;
  memoryDir: string;
  itemsDir: string;
};

const USAGE_FILE = "usage.json";
const USAGE_DIR = "usage";
const CONFIG_FILE = "config.json";

export function createMemoryStore(files: FileStore, options: MemoryStoreOptions = {}): MemoryStore {
  const now = () => options.now?.() ?? new Date();
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function add(bodyInput: string, addOptions: MemoryAddOptions = {}): Promise<MemoryItem> {
    const body = normalizeBody(bodyInput);
    if (!body) throw new Error("memory text is required");

    const created = now();
    const createdAt = formatLocalTimestamp(created, timeZone);
    const id = await nextId(files, body, created, timeZone);
    const item: MemoryItem = {
      meta: {
        id,
        tags: normalizeTags(addOptions.tags),
        createdAt,
        updatedAt: createdAt,
      },
      body,
      path: files.resolve(itemPath(id)),
    };
    await writeItem(files, item);
    return item;
  }

  async function get(id: string): Promise<MemoryItem | null> {
    const path = await resolveItemPath(files, id);
    if (!path) return null;
    const text = await files.readText(path);
    if (text === undefined) return null;
    return parseItem(text, files.resolve(path));
  }

  async function show(id: string): Promise<MemoryItem | null> {
    const item = await get(id);
    if (!item) return null;
    await touchUsage(id);
    return item;
  }

  async function updateTags(id: string, update: MemoryTagUpdate): Promise<MemoryItem> {
    const item = await get(id);
    if (!item) throw new Error(`Memory not found: ${id}`);

    let tags = update.tags ? normalizeTags(update.tags) : item.meta.tags;
    if (update.remove?.length) {
      const remove = new Set(normalizeTags(update.remove));
      tags = tags.filter((tag) => !remove.has(tag));
    }
    if (update.add?.length) tags = normalizeTags([...tags, ...update.add]);

    const updated: MemoryItem = {
      ...item,
      meta: {
        ...item.meta,
        tags,
        updatedAt: formatLocalTimestamp(now(), timeZone),
      },
    };
    const path = (await resolveItemPath(files, id)) ?? itemPath(id);
    await writeItem(files, updated, path);
    return updated;
  }

  async function del(id: string): Promise<boolean> {
    const path = await resolveItemPath(files, id);
    if (!path) return false;
    await files.remove(path);
    return true;
  }

  async function clean(cleanOptions: MemoryCleanOptions = {}): Promise<MemoryCleanResult> {
    const config = await readConfig();
    const olderThan = cleanOptions.olderThan ?? config.clean?.olderThan;
    if (!olderThan) return { candidates: [], removed: [], invalid: [] };

    const durationMs = parseDuration(olderThan);
    const cutoff = now().getTime() - durationMs;
    const usage = await readUsage();
    const candidates: string[] = [];
    const removed: string[] = [];
    const invalid: string[] = [];

    for (const path of await listItemPaths(files)) {
      try {
        const text = await files.readText(path);
        if (text === undefined) continue;
        const item = parseItem(text, files.resolve(path));
        const lastUsed = usage.items[item.meta.id]?.lastAccessedAt ?? item.meta.createdAt;
        if (Date.parse(lastUsed) < cutoff) {
          candidates.push(item.meta.id);
          if (!cleanOptions.dryRun) {
            await files.remove(path);
            removed.push(item.meta.id);
          }
        }
      } catch {
        invalid.push(basename(path, ".md"));
      }
    }

    return { candidates, removed, invalid };
  }

  async function readUsage(): Promise<MemoryUsage> {
    const usage = await readLegacyUsage();
    for (const event of await readUsageEvents()) {
      applyUsageEvent(usage, event);
    }
    return usage;
  }

  async function touchUsage(id: string): Promise<void> {
    const accessedAt = formatLocalTimestamp(now(), timeZone);
    await appendUsageEvent({ action: "show", id, accessedAt });
  }

  async function readLegacyUsage(): Promise<MemoryUsage> {
    const value = await files.read<MemoryUsage>(USAGE_FILE);
    if (!value || typeof value !== "object" || !value.items) return { items: {} };
    return { items: { ...value.items } };
  }

  async function readUsageEvents(): Promise<MemoryUsageEvent[]> {
    const events: MemoryUsageEvent[] = [];
    for (const path of await listUsagePaths(files)) {
      const text = await files.readText(path);
      if (!text) continue;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Partial<MemoryUsageEvent>;
          if (event.action === "show" && event.id && event.accessedAt) {
            events.push({ action: event.action, id: event.id, accessedAt: event.accessedAt });
          }
        } catch {}
      }
    }
    return events;
  }

  async function appendUsageEvent(event: MemoryUsageEvent): Promise<void> {
    const path = usagePath(event.accessedAt);
    const existing = await files.readText(path);
    await files.writeText(path, `${existing ?? ""}${JSON.stringify(event)}\n`);
  }

  async function readConfig(): Promise<MemoryConfig> {
    return (await files.read<MemoryConfig>(CONFIG_FILE)) ?? {};
  }

  return {
    add,
    get,
    show,
    updateTags,
    delete: del,
    clean,
    usage: readUsage,
    memoryDir: files.root,
    itemsDir: files.resolve("items"),
  };
}

function applyUsageEvent(usage: MemoryUsage, event: MemoryUsageEvent): void {
  const previous = usage.items[event.id];
  usage.items[event.id] = {
    accessCount: (previous?.accessCount ?? 0) + 1,
    lastAccessedAt:
      previous && Date.parse(previous.lastAccessedAt) > Date.parse(event.accessedAt)
        ? previous.lastAccessedAt
        : event.accessedAt,
  };
}

export function parseDuration(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60 * 1000
          : unit === "h"
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
  return amount * multiplier;
}

function itemPath(id: string): string {
  return join("items", itemPartition(id), `${id}.md`);
}

function legacyItemPath(id: string): string {
  return join("items", `${id}.md`);
}

function itemPartition(id: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!match) return "unknown";
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function resolveItemPath(files: FileStore, id: string): Promise<string | null> {
  const partitioned = itemPath(id);
  if (await files.exists(partitioned)) return partitioned;
  const legacy = legacyItemPath(id);
  if (await files.exists(legacy)) return legacy;
  return null;
}

async function listItemPaths(files: FileStore, path = "items"): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await files.list(path)) {
    if (entry.isDirectory) {
      out.push(...(await listItemPaths(files, entry.path)));
    } else if (entry.isFile && entry.name.endsWith(".md")) {
      out.push(entry.path);
    }
  }
  return out.sort();
}

async function listUsagePaths(files: FileStore, path = USAGE_DIR): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await files.list(path)) {
    if (entry.isDirectory) {
      out.push(...(await listUsagePaths(files, entry.path)));
    } else if (entry.isFile && entry.name.endsWith(".jsonl")) {
      out.push(entry.path);
    }
  }
  return out.sort();
}

function usagePath(accessedAt: string): string {
  return join(USAGE_DIR, `${accessedAt.slice(0, 10)}.jsonl`);
}

async function nextId(files: FileStore, body: string, date: Date, timeZone: string): Promise<string> {
  const base = `${formatDateId(date, timeZone)}-${slugify(body)}`;
  let id = base;
  let suffix = 2;
  while (await resolveItemPath(files, id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function formatDateId(date: Date, timeZone: string): string {
  const { year, month, day, hour, minute, second } = localDateParts(date, timeZone);
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function formatLocalTimestamp(date: Date, timeZone: string): string {
  const parts = localDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${timeZoneOffset(date, parts)}`;
}

function localDateParts(
  date: Date,
  timeZone: string,
): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: parts.hour ?? "00",
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

function timeZoneOffset(date: Date, parts: ReturnType<typeof localDateParts>): string {
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const dateWithoutMs = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((localAsUtc - dateWithoutMs) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "memory";
}

function normalizeBody(value: string): string {
  return value.trim();
}

function normalizeTags(tags: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function writeItem(files: FileStore, item: MemoryItem, path = itemPath(item.meta.id)): Promise<void> {
  await files.writeText(path, serializeItem(item));
}

function serializeItem(item: MemoryItem): string {
  return [
    "---",
    `id: ${item.meta.id}`,
    `tags: [${item.meta.tags.join(", ")}]`,
    `createdAt: ${item.meta.createdAt}`,
    `updatedAt: ${item.meta.updatedAt}`,
    "---",
    "",
    item.body,
    "",
  ].join("\n");
}

function parseItem(content: string, path: string): MemoryItem {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) throw new Error(`Invalid memory frontmatter: ${path}`);
  const meta = parseFrontmatter(match[1] ?? "");
  if (!meta.id || !meta.createdAt || !meta.updatedAt) {
    throw new Error(`Invalid memory frontmatter: ${path}`);
  }
  return {
    meta: {
      id: meta.id,
      tags: meta.tags ?? [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    },
    body: (match[2] ?? "").replace(/\r\n/g, "\n").replace(/^\n/, "").replace(/\n$/, ""),
    path,
  };
}

function parseFrontmatter(text: string): Partial<MemoryMeta> {
  const meta: Partial<MemoryMeta> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (key === "id") meta.id = rawValue;
    else if (key === "createdAt") meta.createdAt = rawValue;
    else if (key === "updatedAt") meta.updatedAt = rawValue;
    else if (key === "tags") meta.tags = parseTags(rawValue);
  }
  return meta;
}

function parseTags(value: string): string[] {
  if (!value) return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    return normalizeTags(value.slice(1, -1).split(","));
  }
  return normalizeTags([value]);
}
