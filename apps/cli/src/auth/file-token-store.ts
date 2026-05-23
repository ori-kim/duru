import { chmod } from "node:fs/promises";
import type { OAuthSubject, OAuthToken, OAuthTokenStore } from "@duru/auth";
import type { GatewayStore } from "@duru/cli-gateway";
import type { FileStore } from "@duru/file-store";

export type CreateTargetFileOAuthTokenStoreOptions = {
  files: FileStore;
  targets: GatewayStore;
};

type StoredOAuthToken = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  provider?: string;
  client_id?: string;
};

export function createTargetFileOAuthTokenStore(options: CreateTargetFileOAuthTokenStoreOptions): OAuthTokenStore {
  return {
    async get(subject) {
      const path = await authPath(options, subject);
      if (!path) return undefined;

      const stored = await options.files.read<StoredOAuthToken>(path);
      if (!stored) return undefined;
      if (stored.provider && stored.provider !== subject.provider) return undefined;

      return tokenFromStored(stored);
    },
    async set(subject, token) {
      const path = await requireAuthPath(options, subject);
      await options.files.write(path, storedFromToken(subject, token));
      await chmod(options.files.resolve(path), 0o600);
    },
    async delete(subject) {
      const path = await authPath(options, subject);
      if (path) await options.files.remove(path);
    },
  };
}

async function requireAuthPath(
  options: CreateTargetFileOAuthTokenStoreOptions,
  subject: OAuthSubject,
): Promise<string> {
  const path = await authPath(options, subject);
  if (!path) throw new Error(`Unknown gateway target: "${subject.target}"`);
  return path;
}

async function authPath(
  options: CreateTargetFileOAuthTokenStoreOptions,
  subject: OAuthSubject,
): Promise<string | undefined> {
  const target = await options.targets.getTarget(subject.target);
  if (!target) return undefined;

  const type = storeSegment(target.type, "target type");
  const name = storeSegment(target.name, "target name");
  if (!subject.profile) return `${type}/${name}/auth.json`;

  const profile = storeSegment(subject.profile, "profile name");
  return `${type}/${name}/auth/${profile}.json`;
}

function storedFromToken(subject: OAuthSubject, token: OAuthToken): StoredOAuthToken {
  return {
    access_token: token.accessToken,
    token_type: token.tokenType,
    ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
    ...(token.expiresAt !== undefined ? { expires_at: token.expiresAt } : {}),
    ...(token.scope ? { scope: token.scope } : {}),
    ...(token.clientId ? { client_id: token.clientId } : {}),
    provider: subject.provider,
  };
}

function tokenFromStored(stored: StoredOAuthToken): OAuthToken | undefined {
  if (typeof stored.access_token !== "string" || stored.access_token.length === 0) return undefined;
  const tokenType = stored.token_type ?? "Bearer";
  if (tokenType !== "Bearer") return undefined;

  return {
    accessToken: stored.access_token,
    tokenType: "Bearer",
    ...(typeof stored.refresh_token === "string" && stored.refresh_token.length > 0
      ? { refreshToken: stored.refresh_token }
      : {}),
    ...(typeof stored.expires_at === "number" ? { expiresAt: stored.expires_at } : {}),
    ...(typeof stored.scope === "string" && stored.scope.length > 0 ? { scope: stored.scope } : {}),
    ...(typeof stored.client_id === "string" && stored.client_id.length > 0 ? { clientId: stored.client_id } : {}),
  };
}

function storeSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}
