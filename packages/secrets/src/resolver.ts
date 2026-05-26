import { ProviderUnavailable } from "./errors.ts";
import type { SecretProvider } from "./provider.ts";
import { type SecretRef, parseReference } from "./reference.ts";

export interface SecretResolver {
  readonly schemes: readonly string[];
  resolve(ref: string | SecretRef): Promise<string | undefined>;
  store(ref: string | SecretRef, value: string): Promise<void>;
  remove(ref: string | SecretRef): Promise<void>;
  list(scheme: string, prefix?: string): Promise<string[]>;
  providerFor(ref: string | SecretRef): SecretProvider;
  clearCache(): void;
}

export function createResolver(providers: readonly SecretProvider[]): SecretResolver {
  const registry = new Map<string, SecretProvider>();
  for (const p of providers) {
    if (registry.has(p.scheme)) throw new Error(`Duplicate provider scheme: ${p.scheme}`);
    registry.set(p.scheme, p);
  }
  const cache = new Map<string, string | undefined>();

  function getProvider(ref: SecretRef): SecretProvider {
    const p = registry.get(ref.scheme);
    if (!p) throw new ProviderUnavailable(ref.scheme, "scheme not registered");
    return p;
  }

  function normalize(ref: string | SecretRef): SecretRef {
    return typeof ref === "string" ? parseReference(ref) : ref;
  }

  function key(ref: SecretRef): string {
    return `${ref.scheme}://${ref.path}`;
  }

  return {
    schemes: [...registry.keys()],
    async resolve(input) {
      const ref = normalize(input);
      const k = key(ref);
      if (cache.has(k)) return cache.get(k);
      const v = await getProvider(ref).get(ref.path);
      cache.set(k, v);
      return v;
    },
    async store(input, value) {
      const ref = normalize(input);
      await getProvider(ref).set(ref.path, value);
      cache.delete(key(ref));
    },
    async remove(input) {
      const ref = normalize(input);
      await getProvider(ref).delete(ref.path);
      cache.delete(key(ref));
    },
    async list(scheme, prefix) {
      const p = registry.get(scheme);
      if (!p) throw new ProviderUnavailable(scheme, "scheme not registered");
      return p.list(prefix);
    },
    providerFor(input) {
      return getProvider(normalize(input));
    },
    clearCache() {
      cache.clear();
    },
  };
}
