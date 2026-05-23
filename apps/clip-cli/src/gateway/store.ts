import { chmod } from "node:fs/promises";
import type {
  GatewayAliasRecord,
  GatewayBindingRecord,
  GatewayProfileRecord,
  GatewayStore,
  GatewayTargetRecord,
} from "@clip/cli-gateway";
import type { FileStore } from "@clip/file-store";

export type AppGatewayStoreFormat = "json" | "yaml" | "toml";

export type CreateAppGatewayStoreOptions = {
  files: FileStore;
  shims?: FileStore;
  format?: AppGatewayStoreFormat;
};

type TargetFileRecord = Omit<GatewayTargetRecord, "source">;
type ProfileFileRecord = Omit<GatewayProfileRecord, "source">;
type BindingFileRecord = Omit<GatewayBindingRecord, "source">;
type AliasFileRecord = Omit<GatewayAliasRecord, "source">;

const readableExtensions = ["toml", "yml", "yaml", "json"] as const;

export function createAppGatewayStore(options: CreateAppGatewayStoreOptions): GatewayStore {
  const files = options.files;
  const shims = options.shims;
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
    const existing = await getTarget(name);
    if (existing && existing.type !== type) {
      await removeTarget(name);
    }
    await files.write(targetConfigPath(type, name, extension), targetPayload(record));
    await removeOtherTargetConfigs(type, name, extension);
  }

  async function removeTarget(name: string): Promise<void> {
    const targetName = assertStoreSegment(name, "target name");
    for (const typeEntry of await files.list()) {
      if (!typeEntry.isDirectory) continue;
      await files.remove(`${typeEntry.name}/${targetName}`, { recursive: true });
    }
    for (const binding of await listBindings()) {
      if (binding.target === targetName) await removeBinding(binding.name);
    }
  }

  async function removeOtherTargetConfigs(type: string, name: string, keptExtension: string): Promise<void> {
    for (const readExtension of readExtensions) {
      if (readExtension === keptExtension) continue;
      await files.remove(targetConfigPath(type, name, readExtension));
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

  async function listBindings(): Promise<readonly GatewayBindingRecord[]> {
    const records: GatewayBindingRecord[] = [];
    for (const entry of await files.list(bindingDir())) {
      const entryExtension = structuredExtensionFromName(entry.name);
      if (!entry.isFile || !entryExtension) continue;
      const name = entry.name.slice(0, -entryExtension.length - 1);
      const binding = await readBindingPathAt(name, entryExtension);
      if (binding) records.push(binding);
    }
    return records.sort(compareNamedRecords);
  }

  async function getBinding(name: string): Promise<GatewayBindingRecord | undefined> {
    return readBindingAt(assertStoreSegment(name, "binding name"));
  }

  async function saveBinding(record: GatewayBindingRecord): Promise<void> {
    const name = assertStoreSegment(record.name, "binding name");
    await files.write(bindingPath(name, extension), bindingPayload(record));
    await writeShim(record);
  }

  async function removeBinding(name: string): Promise<void> {
    const bindingName = assertStoreSegment(name, "binding name");
    for (const readExtension of readExtensions) {
      await files.remove(bindingPath(bindingName, readExtension));
    }
    await shims?.remove(bindingName);
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

  async function writeShim(record: GatewayBindingRecord): Promise<void> {
    if (!shims) return;
    const name = assertStoreSegment(record.name, "binding name");
    await shims.writeText(name, `#!/usr/bin/env sh\nexec clip ${shellQuote(name)} "$@"\n`);
    await chmod(shims.resolve(name), 0o755);
  }

  async function readTargetAt(type: string, name: string): Promise<GatewayTargetRecord | undefined> {
    for (const readExtension of readExtensions) {
      const path = targetConfigPath(type, name, readExtension);
      const record = await files.read<Record<string, unknown>>(path);
      if (record) return targetWithSidecars(targetFromFile(record, type, name, source(path, readExtension)));
    }
    return undefined;
  }

  async function targetWithSidecars(target: GatewayTargetRecord): Promise<GatewayTargetRecord> {
    return targetWithLegacyAuthSidecar(await targetWithSidecarSpec(target));
  }

  async function targetWithSidecarSpec(target: GatewayTargetRecord): Promise<GatewayTargetRecord> {
    if (target.type !== "api" || !isRecord(target.config) || Object.hasOwn(target.config, "spec")) return target;

    const spec = await readSidecarSpec(target.type, target.name);
    if (spec === undefined) return target;

    return {
      ...target,
      config: { ...target.config, spec },
    };
  }

  async function targetWithLegacyAuthSidecar(target: GatewayTargetRecord): Promise<GatewayTargetRecord> {
    if (!isRecord(target.config) || target.config.auth !== "oauth") return target;

    const auth = await readLegacyOAuthProvider(target.type, target.name);
    if (!auth) return target;

    return {
      ...target,
      config: { ...target.config, auth },
    };
  }

  async function readSidecarSpec(type: string, target: string): Promise<unknown | undefined> {
    for (const readExtension of readExtensions) {
      const spec = await files.read<unknown>(sidecarSpecPath(type, target, readExtension));
      if (spec !== undefined) return spec;
    }
    return undefined;
  }

  async function readLegacyOAuthProvider(type: string, target: string): Promise<Record<string, unknown> | undefined> {
    const record = await files.read<Record<string, unknown>>(legacyAuthPath(type, target));
    return record ? legacyOAuthProviderFromSidecar(record) : undefined;
  }

  async function readProfileAt(type: string, target: string, name: string): Promise<GatewayProfileRecord | undefined> {
    for (const readExtension of readExtensions) {
      const record = await readProfilePathAt(type, target, name, readExtension);
      if (record) return record;
    }
    return undefined;
  }

  async function readBindingAt(name: string): Promise<GatewayBindingRecord | undefined> {
    for (const readExtension of readExtensions) {
      const record = await readBindingPathAt(name, readExtension);
      if (record) return record;
    }
    return undefined;
  }

  async function readBindingPathAt(name: string, readExtension: string): Promise<GatewayBindingRecord | undefined> {
    const path = bindingPath(name, readExtension);
    const record = await files.read<BindingFileRecord>(path);
    return record ? { ...record, source: source(path, readExtension) } : undefined;
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
    listBindings,
    getBinding,
    saveBinding,
    removeBinding,
    listAliases,
    saveAlias,
    removeAlias,
  };
}

function targetConfigPath(type: string, name: string, extension: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(name, "target name")}/config.${extension}`;
}

function sidecarSpecPath(type: string, name: string, extension: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(name, "target name")}/spec.${extension}`;
}

function legacyAuthPath(type: string, name: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(name, "target name")}/auth.json`;
}

function profileDir(type: string, target: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(target, "target name")}/profiles`;
}

function profilePath(type: string, target: string, name: string, extension: string): string {
  return `${profileDir(type, target)}/${assertStoreSegment(name, "profile name")}.${extension}`;
}

function bindingDir(): string {
  return "_bindings";
}

function bindingPath(name: string, extension: string): string {
  return `${bindingDir()}/${assertStoreSegment(name, "binding name")}.${extension}`;
}

function aliasDir(type: string, target: string): string {
  return `${assertStoreSegment(type, "target type")}/${assertStoreSegment(target, "target name")}/aliases`;
}

function aliasPath(type: string, target: string, name: string, extension: string): string {
  return `${aliasDir(type, target)}/${assertStoreSegment(name, "alias name")}.${extension}`;
}

function targetPayload(record: GatewayTargetRecord): TargetFileRecord {
  const { source: _source, ...payload } = record;
  return withoutUndefined(payload);
}

function profilePayload(target: string, record: GatewayProfileRecord): ProfileFileRecord {
  const { source: _source, ...payload } = record;
  return { ...payload, target };
}

function bindingPayload(record: GatewayBindingRecord): BindingFileRecord {
  const { source: _source, ...payload } = record;
  return withoutUndefined(payload);
}

function aliasPayload(target: string, record: GatewayAliasRecord): AliasFileRecord {
  const { source: _source, ...payload } = record;
  return { ...payload, target };
}

function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
    defaultProfile: typeof record.defaultProfile === "string" ? record.defaultProfile : undefined,
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
    defaultProfile: _defaultProfile,
    timeoutMs: _timeoutMs,
    source: _source,
    ...config
  } = record;
  return config;
}

function legacyOAuthProviderFromSidecar(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const provider =
    stringValue(record.provider) ??
    stringValue(record.authorization_server) ??
    stringValue(record.issuer) ??
    stringValue(record.resource_url);
  const authorizationEndpoint = stringValue(record.authorizationEndpoint) ?? stringValue(record.authorization_endpoint);
  const tokenEndpoint = stringValue(record.tokenEndpoint) ?? stringValue(record.token_endpoint);
  const registrationEndpoint = stringValue(record.registrationEndpoint) ?? stringValue(record.registration_endpoint);
  const redirectUri = stringValue(record.redirectUri) ?? stringValue(record.redirect_uri);
  const legacyClientId = stringValue(record.clientId) ?? stringValue(record.client_id);
  const clientId = legacyClientId && (!registrationEndpoint || redirectUri) ? legacyClientId : undefined;

  if (!provider || !authorizationEndpoint || !tokenEndpoint || (!clientId && !registrationEndpoint)) return undefined;

  return withoutUndefined({
    provider,
    authorizationEndpoint,
    tokenEndpoint,
    clientId,
    registrationEndpoint,
    store: storeValue(record.store),
    scopes: scopesValue(record.scopes) ?? scopeStringValue(record.scope),
    redirectUri,
    extraParams: isStringRecord(record.extraParams) ? record.extraParams : undefined,
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function storeValue(value: unknown): "keychain" | "file" | undefined {
  return value === "keychain" || value === "file" ? value : undefined;
}

function scopesValue(value: unknown): readonly string[] | undefined {
  return isStringArray(value) && value.length > 0 ? value : undefined;
}

function scopeStringValue(value: unknown): readonly string[] | undefined {
  if (typeof value !== "string") return undefined;
  const scopes = value.split(/\s+/).filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
