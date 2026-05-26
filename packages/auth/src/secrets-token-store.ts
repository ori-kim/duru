import { ProviderUnavailable, SecretNotFound, type SecretResolver } from "@duru/secrets";
import type { OAuthSubject, OAuthToken, OAuthTokenStore } from "./index.ts";
import type { OAuthBackendConfig } from "./oauth-config.ts";

export function createSecretsOAuthTokenStore(resolver: SecretResolver, config: OAuthBackendConfig): OAuthTokenStore {
  function refFor(subject: OAuthSubject): string {
    const provider = config.targets[subject.target]?.provider ?? config.provider;
    const profile = subject.profile ?? "default";
    return `${provider}://oauth/${subject.target}/${profile}/${subject.provider}`;
  }

  return {
    async get(subject) {
      const json = await resolver.resolve(refFor(subject));
      if (json === undefined) return undefined;
      try {
        const parsed = JSON.parse(json) as unknown;
        if (!isValidToken(parsed)) return undefined;
        return parsed;
      } catch {
        return undefined;
      }
    },
    async set(subject, token) {
      await resolver.store(refFor(subject), JSON.stringify(token));
    },
    async delete(subject) {
      try {
        await resolver.remove(refFor(subject));
      } catch (err) {
        // Provider problems must surface so callers know logout failed.
        // SecretNotFound is benign (already gone).
        if (err instanceof SecretNotFound) return;
        if (err instanceof ProviderUnavailable) throw err;
        throw err;
      }
    },
  };
}

function isValidToken(value: unknown): value is OAuthToken {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === "string" && v.tokenType === "Bearer";
}
