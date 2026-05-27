import type { GatewayOAuthProviderConfig } from "../../auth";
import type { FetchLike } from "./request";

type OAuthProtectedResourceMetadata = {
  resource?: string;
  authorization_servers?: readonly string[];
  scopes_supported?: readonly string[];
};

type OAuthAuthorizationServerMetadata = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: readonly string[];
};

const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";
const authorizationServerMetadataPath = "/.well-known/oauth-authorization-server";

export async function discoverMcpOAuthProvider(input: {
  url: string;
  fetch?: FetchLike;
}): Promise<GatewayOAuthProviderConfig> {
  const fetcher = input.fetch ?? fetch;
  const protectedResourceMetadataUrl =
    (await discoverProtectedResourceMetadataUrl(input.url, fetcher)) ?? defaultProtectedResourceMetadataUrl(input.url);
  const protectedResource = await fetchJsonObject<OAuthProtectedResourceMetadata>(
    fetcher,
    protectedResourceMetadataUrl,
    "OAuth protected resource metadata",
  );
  const authServer = firstString(protectedResource.authorization_servers);
  if (!authServer) {
    throw new Error("OAuth protected resource metadata must include authorization_servers");
  }

  const authServerMetadata = await fetchJsonObject<OAuthAuthorizationServerMetadata>(
    fetcher,
    authorizationServerMetadataUrl(authServer),
    "OAuth authorization server metadata",
  );
  const authorizationEndpoint = stringValue(authServerMetadata.authorization_endpoint);
  const tokenEndpoint = stringValue(authServerMetadata.token_endpoint);
  const registrationEndpoint = stringValue(authServerMetadata.registration_endpoint);
  if (!authorizationEndpoint) {
    throw new Error("OAuth authorization server metadata must include authorization_endpoint");
  }
  if (!tokenEndpoint) {
    throw new Error("OAuth authorization server metadata must include token_endpoint");
  }
  if (!registrationEndpoint) {
    throw new Error("OAuth authorization server metadata must include registration_endpoint");
  }

  const resource = stringValue(protectedResource.resource) ?? input.url;
  const provider = normalizeIssuer(stringValue(authServerMetadata.issuer) ?? authServer);
  const scopes = stringArray(protectedResource.scopes_supported) ?? stringArray(authServerMetadata.scopes_supported);

  return withoutUndefined({
    id: provider,
    provider,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    extraParams: { resource },
  });
}

async function discoverProtectedResourceMetadataUrl(url: string, fetcher: FetchLike): Promise<string | undefined> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const header = response.headers.get("www-authenticate");
    return header ? resourceMetadataUrlFromAuthenticate(header) : undefined;
  } catch {
    return undefined;
  }
}

function resourceMetadataUrlFromAuthenticate(value: string): string | undefined {
  const match = /(?:^|[\s,])resource_metadata\s*=\s*(?:"([^"]+)"|([^,\s]+))/iu.exec(value);
  return match?.[1] ?? match?.[2];
}

function defaultProtectedResourceMetadataUrl(url: string): string {
  return new URL(protectedResourceMetadataPath, url).toString();
}

function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/u, "");
  if (path && path !== "/") return `${url.origin}${authorizationServerMetadataPath}${path}`;
  return new URL(authorizationServerMetadataPath, url).toString();
}

async function fetchJsonObject<T extends object>(fetcher: FetchLike, url: string, label: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: "application/json" } });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`${label} request failed with status ${response.status}`);
  }
  const value = (await response.json()) as unknown;
  if (!isRecord(value)) throw new Error(`${label} response must be a JSON object`);
  return value as T;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/u, "");
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
