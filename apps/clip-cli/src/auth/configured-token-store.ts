import type { OAuthSubject, OAuthToken, OAuthTokenStore } from "@clip/auth";
import type { GatewayProfileRecord, GatewayStore, GatewayTargetRecord } from "@clip/cli-gateway";

export type OAuthTokenStoreKind = "keychain" | "file";

export type CreateConfiguredOAuthTokenStoreOptions = {
  targets: GatewayStore;
  keychain: OAuthTokenStore;
  file: OAuthTokenStore;
};

export function createConfiguredOAuthTokenStore(options: CreateConfiguredOAuthTokenStoreOptions): OAuthTokenStore {
  return {
    async get(subject) {
      return selectedStore(options, subject).then((store) => store.get(subject));
    },
    async set(subject, token) {
      return selectedStore(options, subject).then((store) => store.set(subject, token));
    },
    async delete(subject) {
      return selectedStore(options, subject).then((store) => store.delete(subject));
    },
  };
}

async function selectedStore(
  options: CreateConfiguredOAuthTokenStoreOptions,
  subject: OAuthSubject,
): Promise<OAuthTokenStore> {
  const kind = await selectedStoreKind(options.targets, subject);
  return kind === "file" ? options.file : options.keychain;
}

async function selectedStoreKind(targets: GatewayStore, subject: OAuthSubject): Promise<OAuthTokenStoreKind> {
  const target = await targets.getTarget(subject.target);
  if (!target) return "keychain";

  const profile = subject.profile ? await targets.getProfile(target.name, subject.profile) : undefined;
  return authStoreKindFromProfile(profile) ?? authStoreKindFromTarget(target) ?? "keychain";
}

function authStoreKindFromTarget(target: GatewayTargetRecord): OAuthTokenStoreKind | undefined {
  return authStoreKind(target.config);
}

function authStoreKindFromProfile(profile: GatewayProfileRecord | undefined): OAuthTokenStoreKind | undefined {
  return profile?.config ? authStoreKind(profile.config) : undefined;
}

function authStoreKind(config: unknown): OAuthTokenStoreKind | undefined {
  if (!isRecord(config) || !isRecord(config.auth)) return undefined;
  return config.auth.store === "file" || config.auth.store === "keychain" ? config.auth.store : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
