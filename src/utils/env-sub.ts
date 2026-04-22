/**
 * env-sub.ts — env variable substitution helpers shared across builtin normalizeConfig implementations.
 */

export function subRecord(
  r: Record<string, string> | undefined,
  env: Record<string, string>,
): Record<string, string> | undefined {
  if (!r) return r;
  const merged = { ...process.env, ...env } as Record<string, string>;
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, v.replace(/\$\{([^}]+)\}/g, (_, key) => merged[key] ?? "")]),
  );
}

export function subProfiles<P extends { headers?: Record<string, string>; metadata?: Record<string, string> }>(
  profiles: Record<string, P> | undefined,
  env: Record<string, string>,
  fields: ReadonlyArray<"headers" | "metadata">,
): Record<string, P> | undefined {
  if (!profiles) return profiles;
  return Object.fromEntries(
    Object.entries(profiles).map(([name, p]) => {
      const next = { ...p };
      for (const f of fields) {
        const r = next[f];
        if (r) (next as Record<string, unknown>)[f] = subRecord(r, env);
      }
      return [name, next];
    }),
  );
}
