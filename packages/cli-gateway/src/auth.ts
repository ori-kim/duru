import type {
  GatewayAuthContext,
  GatewayAuthState,
  GatewayContext,
  GatewayTargetAuth,
  GatewayTargetRecord,
} from "./types";

export type GatewayOAuthProviderConfig = {
  id: string;
  provider: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId?: string;
  registrationEndpoint?: string;
  clientName?: string;
  store?: "keychain" | "file";
  scopes?: readonly string[];
  redirectUri?: string;
  extraParams?: Record<string, string>;
};

export type GatewayOAuthService = {
  status(input: GatewayOAuthServiceInput): Promise<GatewayAuthState>;
  login(input: GatewayOAuthServiceInput): Promise<GatewayAuthState> | Promise<void>;
  logout(input: GatewayOAuthServiceInput): Promise<GatewayAuthState> | Promise<void>;
  accessToken?(input: GatewayOAuthServiceInput): Promise<string | undefined>;
};

export type GatewayOAuthServiceInput = {
  subject: {
    target: string;
    profile?: string;
    provider: string;
  };
  provider: GatewayOAuthProviderConfig;
  signal?: AbortSignal;
};

export function parseOptionalOAuthProviderConfig(value: unknown): GatewayOAuthProviderConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return undefined;
  if (!isRecord(value)) throw new Error("Invalid auth config: auth must be an object");

  const provider = stringValue(value.provider) ?? stringValue(value.id);
  const authorizationEndpoint = stringValue(value.authorizationEndpoint);
  const tokenEndpoint = stringValue(value.tokenEndpoint);
  const clientId = stringValue(value.clientId);
  const registrationEndpoint = stringValue(value.registrationEndpoint);

  if (!provider) throw new Error("Invalid auth config: provider is required");
  if (!authorizationEndpoint) throw new Error("Invalid auth config: authorizationEndpoint is required");
  if (!tokenEndpoint) throw new Error("Invalid auth config: tokenEndpoint is required");
  if (!clientId && !registrationEndpoint) {
    throw new Error("Invalid auth config: clientId or registrationEndpoint is required");
  }
  if (!isAbsoluteHttpUrl(authorizationEndpoint)) {
    throw new Error("Invalid auth config: authorizationEndpoint must be an absolute URL");
  }
  if (!isAbsoluteHttpUrl(tokenEndpoint)) {
    throw new Error("Invalid auth config: tokenEndpoint must be an absolute URL");
  }
  if (registrationEndpoint && !isAbsoluteHttpUrl(registrationEndpoint)) {
    throw new Error("Invalid auth config: registrationEndpoint must be an absolute URL");
  }
  if (value.clientName !== undefined && typeof value.clientName !== "string") {
    throw new Error("Invalid auth config: clientName must be a string");
  }
  if (value.scopes !== undefined && !isStringArray(value.scopes)) {
    throw new Error("Invalid auth config: scopes must be a string array");
  }
  if (value.redirectUri !== undefined && typeof value.redirectUri !== "string") {
    throw new Error("Invalid auth config: redirectUri must be a string");
  }
  if (value.extraParams !== undefined && !isStringRecord(value.extraParams)) {
    throw new Error("Invalid auth config: extraParams must be a string record");
  }
  if (value.store !== undefined && value.store !== "keychain" && value.store !== "file") {
    throw new Error("Invalid auth config: store must be keychain or file");
  }

  return {
    id: provider,
    provider,
    authorizationEndpoint,
    tokenEndpoint,
    ...(clientId ? { clientId } : {}),
    ...(registrationEndpoint ? { registrationEndpoint } : {}),
    ...(typeof value.clientName === "string" && value.clientName.length > 0 ? { clientName: value.clientName } : {}),
    ...(value.store === "keychain" || value.store === "file" ? { store: value.store } : {}),
    ...(value.scopes ? { scopes: value.scopes } : {}),
    ...(typeof value.redirectUri === "string" && value.redirectUri.length > 0
      ? { redirectUri: value.redirectUri }
      : {}),
    ...(value.extraParams ? { extraParams: value.extraParams } : {}),
  };
}

export function createGatewayTargetAuth(input: {
  manifest: GatewayTargetRecord;
  auth: GatewayOAuthProviderConfig | undefined;
  context: GatewayContext;
}): GatewayTargetAuth | undefined {
  const auth = input.auth;
  if (!auth) return undefined;
  return {
    status: (ctx) => oauthService(input.context).status(serviceInput(input.manifest.name, auth, ctx)),
    login: (ctx) => oauthService(input.context).login(serviceInput(input.manifest.name, auth, ctx)),
    logout: (ctx) => oauthService(input.context).logout(serviceInput(input.manifest.name, auth, ctx)),
  };
}

export async function oauthAuthorizationHeader(input: {
  context: GatewayContext;
  target: string;
  profile?: string;
  auth?: GatewayOAuthProviderConfig;
  headers: Record<string, string>;
  signal?: AbortSignal;
  dryRun?: boolean;
}): Promise<Record<string, string>> {
  if (!input.auth || hasHeader(input.headers, "authorization")) return {};
  if (input.dryRun) return { authorization: "Bearer <redacted>" };

  const token = await oauthService(input.context).accessToken?.({
    subject: subject(input.target, input.profile, input.auth),
    provider: input.auth,
    signal: input.signal,
  });
  return token ? { authorization: `Bearer ${token}` } : {};
}

function serviceInput(
  target: string,
  auth: GatewayOAuthProviderConfig,
  ctx: GatewayAuthContext,
): GatewayOAuthServiceInput {
  return {
    subject: subject(target, ctx.profile, auth),
    provider: auth,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  };
}

function subject(target: string, profile: string | undefined, auth: GatewayOAuthProviderConfig) {
  return {
    target,
    ...(profile ? { profile } : {}),
    provider: auth.provider,
  };
}

function oauthService(context: GatewayContext): GatewayOAuthService {
  const candidate = context.services?.oauth;
  if (isOAuthService(candidate)) return candidate;
  throw new Error("Gateway OAuth service is not configured");
}

function isOAuthService(value: unknown): value is GatewayOAuthService {
  return (
    isRecord(value) &&
    typeof value.status === "function" &&
    typeof value.login === "function" &&
    typeof value.logout === "function"
  );
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
