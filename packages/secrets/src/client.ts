import { SecretNotFound } from "./errors.ts";
import { type Manifest, loadManifest } from "./manifest.ts";
import { type SecretRef, parseReference } from "./reference.ts";
import type { SecretResolver } from "./resolver.ts";

export interface SecretClient {
  get(name: string): Promise<string>;
  getOptional(name: string): Promise<string | undefined>;
  store(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): readonly string[];
  resolveRef(name: string): SecretRef | undefined;
  refresh(): Promise<void>;
  manifest(): Manifest;
  typed<const Names extends readonly string[]>(names: Names): TypedSecretClient<Names[number]>;
}

export interface TypedSecretClient<N extends string> {
  get<K extends N>(name: K): Promise<string>;
  getOptional<K extends N>(name: K): Promise<string | undefined>;
}

export function createSecretClient(manifest: Manifest, resolver: SecretResolver): SecretClient {
  let current: Manifest = manifest;

  function ref(name: string): SecretRef {
    const r = current.data.secrets[name];
    if (!r) throw new SecretNotFound(name);
    return parseReference(r);
  }

  const client: SecretClient = {
    async get(name) {
      const r = ref(name);
      const v = await resolver.resolve(r);
      if (v === undefined) {
        throw new SecretNotFound(`${name} (ref: ${r.scheme}://${r.path})`);
      }
      return v;
    },
    async getOptional(name) {
      const raw = current.data.secrets[name];
      if (!raw) return undefined;
      return resolver.resolve(raw);
    },
    async store(name, value) {
      await resolver.store(ref(name), value);
    },
    async remove(name) {
      await resolver.remove(ref(name));
    },
    list() {
      return Object.keys(current.data.secrets);
    },
    resolveRef(name) {
      const r = current.data.secrets[name];
      return r ? parseReference(r) : undefined;
    },
    async refresh() {
      current = await loadManifest(current.path);
    },
    manifest() {
      return current;
    },
    typed(_names) {
      return {
        async get(name) {
          return client.get(name);
        },
        async getOptional(name) {
          return client.getOptional(name);
        },
      };
    },
  };
  return client;
}
