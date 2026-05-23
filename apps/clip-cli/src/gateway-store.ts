import type { GatewayAliasRecord, GatewayProfileRecord, GatewayStore, GatewayTargetRecord } from "@clip/cli-gateway";
import type { FileStore } from "@clip/file-store";

export type AppGatewayStoreFormat = "json" | "yaml" | "toml";

export type CreateAppGatewayStoreOptions = {
  files: FileStore;
  format?: AppGatewayStoreFormat;
};

type TargetFileRecord = Omit<GatewayTargetRecord, "source">;
type ProfileFileRecord = Omit<GatewayProfileRecord, "source">;
type AliasFileRecord = Omit<GatewayAliasRecord, "source">;

const readableExtensions = ["toml", "yml", "yaml", "json"] as const;

export function createAppGatewayStore(options: CreateAppGatewayStoreOptions): GatewayStore {
  const files = options.files;
  const format = options.format ?? "toml";
  const extension = formatExtension(format);
  const readExtensions = uniqueExtensions([extension, ...readableExtensions]);

  async function listTargets(): Promise<readonly GatewayTargetRecord[]> {
    const records: GatewayTargetRecord[] = [];

    for (const typeEntry of await files.list()) {
      if (!typeEntry.isDirectory) continue;
      for (const targetEntry of await files.list(typeEntry.name)) {
        if (!targetEntry.isDirectory) continue;
        const target = await readTargetAt(typeEntry.name, targetEntry.name);
        if (target) records.push(target);
      }
    }

    return records.sort(compareTargets);
  }

  async function getTarget(name: string): Promise<GatewayTargetRecord | undefined> {
    const targetName = assertStoreSegment(name, "target name");
    return (await listTargets()).find((target) => target.name === targetName);
  }

  async function saveTarget(record: GatewayTargetRecord): Promise<void> {
    const name = assertStoreSegment(record.name, "target name");
    const type = assertStoreSegment(record.type, "target type");
    await removeTarget(name);
    await files.write(targetConfigPath(type, name, extension), targetPayload(record));
  }

  async function removeTarget(name: string): Promise<void> {
    const targetName = assertStoreSegment(name, "target name");
    for (const typeEntry of await files.list()) {
      if (!typeEntry.isDirectory) continue;
      await files.remove(`${typeEntry.name}/${targetName}`, { recursive: true });
    }
  }

  async function listProfiles(target: string): Promise<readonly GatewayProfileRecord[]> {
    const targetRecord = await getTarget(target);
    if (!targetRecord) return [];

    const records: GatewayProfileRecord[] = [];
    for (const entry of await files.list(profileDir(targetRecord.type, targetRecord.name))) {
      const entryExtension = structuredExtensionFromName(entry.name);
      if (!entry.isFile || !entryExtension) continue;
      const name = entry.name.slice(0, -entryExtension.length - 1);
      const profile = await readProfilePathAt(targetRecord.type, targetRecord.name, name, entryExtension);
      if (profile) records.push(profile);
    }
    return records.sort(compareNamedRecords);
  }

  async function getProfile(target: string, name: string): Promise<GatewayProfileRecord | undefined> {
    const targetRecord = await getTarget(target);
    if (!targetRecord) return undefined;
    return readProfileAt(targetRecord.type, targetRecord.name, assertStoreSegment(name, "profile name"));
  }

  async function saveProfile(target: string, profile: GatewayProfileRecord): Promise<void> {
    const targetRecord = await requireTarget(target);
    const name = assertStoreSegment(profile.name, "profile name");
    await files.write(
      profilePath(targetRecord.type, targetRecord.name, name, extension),
      profilePayload(target, profile),
    );
  }

  async function removeProfile(target: string, name: string): Promise<void> {
    const targetRecord = await getTarget(target);
    if (!targetRecord) return;
    const profileName = assertStoreSegment(name, "profile name");
    for (const readExtension of readExtensions) {
      await files.remove(profilePath(targetRecord.type, targetRecord.name, profileName, readExtension));
    }
  }

  async function listAliases(target: string): Promise<readonly GatewayAliasRecord[]> {
    const targetRecord = await getTarget(target);
    if (!targetRecord) return [];

    const records: GatewayAliasRecord[] = [];
    for (const entry of await files.list(aliasDir(targetRecord.type, targetRecord.name))) {
      const entryExtension = structuredExtensionFromName(entry.name);
      if (!entry.isFile || !entryExtension) continue;
      const name = entry.name.slice(0, -entryExtension.length - 1);
      const alias = await readAliasPathAt(targetRecord.type, targetRecord.name, name, entryExtension);
      if (alias) records.push(alias);
    }
    return records.sort(compareNamedRecords);
  }

  async function saveAlias(target: string, alias: GatewayAliasRecord): Promise<void> {
    const targetRecord = await requireTarget(target);
    const name = assertStoreSegment(alias.name, "alias name");
    await files.write(aliasPath(targetRecord.type, targetRecord.name, name, extension), aliasPayload(target, alias));
  }

  async function removeAlias(target: string, name: string): Promise<void> {
    const targetRecord = await getTarget(target);
    if (!targetRecord) return;
    const aliasName = assertStoreSegment(name, "alias name");
    for (const readExtension of readExtensions) {
      await files.remove(aliasPath(targetRecord.type, targetRecord.name, aliasName, readExtension));
    }
  }

  async function readTargetAt(type: string, name: string): Promise<GatewayTargetRecord | undefined> {
    for (const readExtension of readExtensions) {
      const path = targetConfigPath(type, name, readExtension);
      const record = await files.read<Record<string, unknown>>(path);
      if (record) return targetFromFile(record, type, name, source(path, readExtension));
    }
    return undefined;
  }

  async function readProfileAt(type: string, target: string, name: string): Promise<GatewayProfileRecord | undefined> {
    for (const readExtension of readExtensions) {
      const record = await readProfilePathAt(type, target, name, readExtension);
      if (record) return record;
    }
    return undefined;
  }

  async function readProfilePathAt(
    type: string,
    target: string,
    name: string,
    readExtension: string,
  ): Promise<GatewayProfileRecord | undefined> {
    const path = profilePath(type, target, name, readExtension);
    const record = await files.read<ProfileFileRecord>(path);
    return record ? { ...record, source: source(path, readExtension) } : undefined;
  }

  async function readAliasAt(type: string, target: string, name: string): Promise<GatewayAliasRecord | undefined> {
    for (const readExtension of readExtensions) {
      const record = await readAliasPathAt(type, target, name, readExtension);
      if (record) return record;
    }
    return undefined;
  }

  async function readAliasPathAt(
    type: string,
    target: string,
    name: string,
    readExtension: string,
  ): Promise<GatewayAliasRecord | undefined> {
    const path = aliasPath(type, target, name, readExtension);
    const record = await files.read<AliasFileRecord>(path);
    return record ? { ...record, source: source(path, readExtension) } : undefined;
  }

  async function requireTarget(target: string): Promise<GatewayTargetRecord> {
    const record = await getTarget(target);
    if (!record) throw new Error(`Gateway target not found: ${target}`);
    return record;
  }

  function source(path: string, readExtension: string = extension) {
    return { path: files.resolve(path), format: formatFromExtension(readExtension) };
  }

  return {
    listTargets,
    getTarget,
    saveTarget,
    removeTarget,
    listProfiles,
    getProfile,
    saveProfile,
    removeProfile,
    listAliases,
    saveAlias,
    removeAlias,
  };
}

function targetConfigPath(type: string, name: string, extension: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(name, "target name")}/config.${extension}`;
}

function profileDir(type: string, target: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(target, "target name")}/profiles`;
}

function profilePath(type: string, target: string, name: string, extension: string): string {
  return `${profileDir(type, target)}/${assertStoreSegment(name, "profile name")}.${extension}`;
}

function aliasDir(type: string, target: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(target, "target name")}/aliases`;
}

function aliasPath(type: string, target: string, name: string, extension: string): string {
  return `${aliasDir(type, target)}/${assertStoreSegment(name, "alias name")}.${extension}`;
}

function targetPayload(record: GatewayTargetRecord): TargetFileRecord {
  const { source: _source, ...payload } = record;
  return payload;
}

function profilePayload(target: string, record: GatewayProfileRecord): ProfileFileRecord {
  const { source: _source, ...payload } = record;
  return { ...payload, target };
}

function aliasPayload(target: string, record: GatewayAliasRecord): AliasFileRecord {
  const { source: _source, ...payload } = record;
  return { ...payload, target };
}

function targetFromFile(
  record: Record<string, unknown>,
  type: string,
  name: string,
  source: GatewayTargetRecord["source"],
): GatewayTargetRecord {
  return {
    name: typeof record.name === "string" ? record.name : name,
    type: typeof record.type === "string" ? record.type : type,
    config: Object.prototype.hasOwnProperty.call(record, "config") ? record.config : legacyTargetConfig(record),
    allow: isStringArray(record.allow) ? record.allow : undefined,
    deny: isStringArray(record.deny) ? record.deny : undefined,
    acl: isRecord(record.acl) ? record.acl : undefined,
    timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined,
    source,
  };
}

function legacyTargetConfig(record: Record<string, unknown>): Record<string, unknown> {
  const {
    name: _name,
    type: _type,
    allow: _allow,
    deny: _deny,
    acl: _acl,
    timeoutMs: _timeoutMs,
    source: _source,
    ...config
  } = record;
  return config;
}

function formatExtension(format: AppGatewayStoreFormat): string {
  if (format === "json") return "json";
  if (format === "toml") return "toml";
  return "yml";
}

function formatFromExtension(extension: string): AppGatewayStoreFormat {
  if (extension === "json") return "json";
  if (extension === "toml") return "toml";
  return "yaml";
}

function uniqueExtensions(extensions: readonly string[]): readonly string[] {
  return [...new Set(extensions)];
}

function structuredExtensionFromName(name: string): string | undefined {
  return readableExtensions.find((extension) => name.endsWith(`.${extension}`));
}

function assertStoreSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`Invalid gateway ${label}: ${value}`);
  }
  return value;
}

function compareTargets(left: GatewayTargetRecord, right: GatewayTargetRecord): number {
  return left.name.localeCompare(right.name) || left.type.localeCompare(right.type);
}

function compareNamedRecords<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
