import type {
  GatewayAliasRecord,
  GatewayBindingRecord,
  GatewayCatalogRecord,
  GatewayProfileRecord,
  GatewayStore,
  GatewayStoreSeed,
  GatewayTargetRecord,
} from "./types";

export function createMemoryGatewayStore(seed: GatewayStoreSeed = {}): GatewayStore {
  const targets = new Map<string, GatewayTargetRecord>();
  const profiles = new Map<string, GatewayProfileRecord>();
  const bindings = new Map<string, GatewayBindingRecord>();
  const catalogs = new Map<string, GatewayCatalogRecord>();
  const aliases = new Map<string, GatewayAliasRecord>();

  for (const target of seed.targets ?? []) targets.set(target.name, clone(target));
  for (const profile of seed.profiles ?? []) profiles.set(scopedKey(profile.target, profile.name), clone(profile));
  for (const binding of seed.bindings ?? []) bindings.set(binding.name, clone(binding));
  for (const catalog of seed.catalogs ?? []) catalogs.set(catalog.target, clone(catalog));
  for (const alias of seed.aliases ?? []) aliases.set(scopedKey(alias.target, alias.name), clone(alias));

  return {
    async listTargets() {
      return sortedByName([...targets.values()]).map(clone);
    },
    async getTarget(name) {
      return cloneOptional(targets.get(name));
    },
    async saveTarget(record) {
      targets.set(record.name, clone(record));
    },
    async removeTarget(name) {
      targets.delete(name);
      deleteScoped(profiles, name);
      deleteScoped(aliases, name);
      deleteBindingsForTarget(bindings, name);
      catalogs.delete(name);
    },
    async listProfiles(target) {
      return sortedByName(scopedValues(profiles, target)).map(clone);
    },
    async getProfile(target, name) {
      return cloneOptional(profiles.get(scopedKey(target, name)));
    },
    async saveProfile(target, profile) {
      profiles.set(scopedKey(target, profile.name), clone({ ...profile, target }));
    },
    async removeProfile(target, name) {
      profiles.delete(scopedKey(target, name));
    },
    async listBindings() {
      return sortedByName([...bindings.values()]).map(clone);
    },
    async getBinding(name) {
      return cloneOptional(bindings.get(name));
    },
    async saveBinding(record) {
      bindings.set(record.name, clone(record));
    },
    async removeBinding(name) {
      bindings.delete(name);
    },
    async listCatalogs() {
      return sortedByTarget([...catalogs.values()]).map(clone);
    },
    async getCatalog(target) {
      return cloneOptional(catalogs.get(target));
    },
    async saveCatalog(record) {
      catalogs.set(record.target, clone(record));
    },
    async removeCatalog(target) {
      catalogs.delete(target);
    },
    async listAliases(target) {
      return sortedByName(scopedValues(aliases, target)).map(clone);
    },
    async saveAlias(target, alias) {
      aliases.set(scopedKey(target, alias.name), clone({ ...alias, target }));
    },
    async removeAlias(target, name) {
      aliases.delete(scopedKey(target, name));
    },
    snapshot() {
      return {
        targets: sortedByName([...targets.values()]).map(clone),
        bindings: sortedByName([...bindings.values()]).map(clone),
        catalogs: sortedByTarget([...catalogs.values()]).map(clone),
      };
    },
  };
}

function scopedKey(target: string, name: string): string {
  return `${target}\0${name}`;
}

function scopedValues<T extends { target: string }>(records: Map<string, T>, target: string): T[] {
  return [...records.values()].filter((record) => record.target === target);
}

function deleteScoped<T extends { target: string }>(records: Map<string, T>, target: string): void {
  for (const [key, record] of records.entries()) {
    if (record.target === target) records.delete(key);
  }
}

function deleteBindingsForTarget(records: Map<string, GatewayBindingRecord>, target: string): void {
  for (const [key, record] of records.entries()) {
    if (record.target === target) records.delete(key);
  }
}

function sortedByName<T extends { name: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

function sortedByTarget<T extends { target: string }>(records: T[]): T[] {
  return records.sort((left, right) => left.target.localeCompare(right.target));
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
