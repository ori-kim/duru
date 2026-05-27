import { type SecretResolver, isSecretRefString } from "@duru/secrets";

export function isSecretRef(value: unknown, knownSchemes: readonly string[]): value is string {
  return isSecretRefString(value, knownSchemes);
}

/**
 * Walks the value recursively. Any string matching a registered secret scheme
 * is replaced by the resolved value. Missing secrets become empty string
 * (matches gateway env interpolation convention).
 */
export async function resolveSecrets<T>(value: T, resolver: SecretResolver): Promise<T> {
  return (await walk(value, resolver)) as T;
}

async function walk(value: unknown, resolver: SecretResolver): Promise<unknown> {
  if (typeof value === "string") {
    if (isSecretRefString(value, resolver.schemes)) {
      return (await resolver.resolve(value)) ?? "";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => walk(item, resolver)));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = await walk(item, resolver);
    }
    return out;
  }
  return value;
}
