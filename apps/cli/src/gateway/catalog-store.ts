import type { GatewayCatalogRecord, GatewayStore, GatewayTool } from "@duru/cli-gateway";
import type { FileStore } from "@duru/file-store";

export function withGatewayCatalogCache(store: GatewayStore, files: FileStore): GatewayStore {
  return {
    ...store,
    async listCatalogs() {
      const records: GatewayCatalogRecord[] = [];
      for (const entry of await files.list(catalogDir())) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        const target = entry.name.slice(0, -".json".length);
        const record = await readCatalog(target);
        if (record) records.push(record);
      }
      return records.sort((left, right) => left.target.localeCompare(right.target));
    },
    getCatalog(target) {
      return readCatalog(target);
    },
    async saveCatalog(record) {
      const target = assertCatalogSegment(record.target);
      await files.write(catalogPath(target), catalogPayload(record));
    },
    async removeCatalog(target) {
      await files.remove(catalogPath(assertCatalogSegment(target)));
    },
    async removeTarget(name) {
      await store.removeTarget(name);
      await files.remove(catalogPath(assertCatalogSegment(name)));
    },
  };

  async function readCatalog(target: string): Promise<GatewayCatalogRecord | undefined> {
    const name = assertCatalogSegment(target);
    const path = catalogPath(name);
    const record = await files.read<CatalogFileRecord>(path);
    const operations = catalogOperations(record?.operations);
    if (!record || !operations) return undefined;
    return {
      target: typeof record.target === "string" ? record.target : name,
      operations,
      refreshedAt: typeof record.refreshedAt === "string" ? record.refreshedAt : undefined,
      source: { path: files.resolve(path), format: "json" },
    };
  }
}

type CatalogFileRecord = {
  target?: string;
  operations?: unknown;
  refreshedAt?: string;
};

function catalogDir(): string {
  return "_catalogs";
}

function catalogPath(target: string): string {
  return `${catalogDir()}/${assertCatalogSegment(target)}.json`;
}

function catalogPayload(record: GatewayCatalogRecord): CatalogFileRecord {
  return {
    target: record.target,
    operations: record.operations,
    refreshedAt: record.refreshedAt,
  };
}

function catalogOperations(value: unknown): readonly GatewayTool[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => (isGatewayTool(item) ? [item] : []));
}

function isGatewayTool(value: unknown): value is GatewayTool {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) return false;
  return value.description === undefined || typeof value.description === "string";
}

function assertCatalogSegment(value: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`Invalid gateway catalog target: ${value}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
