import type { ManifestData } from "@duru/secrets";

export type OAuthBackendConfig = {
  /** Default scheme for OAuth token storage (e.g., "keychain", "file", "op"). */
  provider: string;
  /** Per-target override of the storage scheme. Key is gateway target name. */
  targets: Record<string, { provider: string }>;
};

/**
 * Prefix reserved on manifest secret names so OAuth-managed entries can't
 * collide with user-defined secrets. @duru/auth registers this with
 * loadManifest({ reservedPrefixes: OAUTH_RESERVED_PREFIXES }).
 */
export const OAUTH_RESERVED_PREFIXES = ["oauth/"] as const;

const SCHEME_NAME_RE = /^[a-z][a-z0-9+.-]*$/;
const DEFAULT_PROVIDER = "file";

/**
 * Extract and validate OAuth backend config from a manifest's extensions slot.
 * Returns a defaulted config when extensions.oauth is missing.
 */
export function parseOAuthBackendConfig(data: ManifestData): OAuthBackendConfig {
  const ext = data.extensions ?? {};
  const oa = (ext as Record<string, unknown>).oauth;
  if (oa === undefined) {
    return { provider: DEFAULT_PROVIDER, targets: {} };
  }
  if (!oa || typeof oa !== "object" || Array.isArray(oa)) {
    throw new Error("extensions.oauth must be an object");
  }
  const obj = oa as Record<string, unknown>;

  const provider = obj.provider ?? DEFAULT_PROVIDER;
  if (typeof provider !== "string" || !SCHEME_NAME_RE.test(provider)) {
    throw new Error(`Invalid extensions.oauth.provider scheme name: ${String(provider)}`);
  }

  const rawTargets = obj.targets;
  if (
    rawTargets !== undefined &&
    (typeof rawTargets !== "object" || rawTargets === null || Array.isArray(rawTargets))
  ) {
    throw new Error("extensions.oauth.targets must be an object if present");
  }
  const targets: Record<string, { provider: string }> = {};
  if (rawTargets) {
    for (const [name, cfg] of Object.entries(rawTargets as Record<string, unknown>)) {
      if (!cfg || typeof cfg !== "object") {
        throw new Error(`extensions.oauth.targets.${name} must be an object`);
      }
      const c = cfg as Record<string, unknown>;
      if (typeof c.provider !== "string" || !SCHEME_NAME_RE.test(c.provider)) {
        throw new Error(`Invalid extensions.oauth.targets.${name}.provider scheme name: ${String(c.provider)}`);
      }
      targets[name] = { provider: c.provider };
    }
  }
  return { provider, targets };
}
