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
  return (await walk(value, resolver, "resolve")) as T;
}

export async function redactSecrets<T>(value: T, resolver: SecretResolver): Promise<T> {
  return (await walk(value, resolver, "redact")) as T;
}

async function walk(value: unknown, resolver: SecretResolver, mode: "resolve" | "redact"): Promise<unknown> {
  if (typeof value === "string") {
    if (isSecretRefString(value, resolver.schemes)) {
      if (mode === "redact") return "<redacted>";
      return (await resolver.resolve(value)) ?? "";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => walk(item, resolver, mode)));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = await walk(item, resolver, mode);
    }
    return out;
  }
  return value;
}
