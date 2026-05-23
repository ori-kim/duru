import { createHash, randomBytes } from "node:crypto";

export type OAuthProviderConfig = {
  id: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId?: string;
  registrationEndpoint?: string;
  clientName?: string;
  scopes?: readonly string[];
  redirectUri?: string;
  extraParams?: Record<string, string>;
};

type OAuthClientProviderConfig = OAuthProviderConfig & {
  clientId: string;
};

export type OAuthSubject = {
  target: string;
  profile?: string;
  provider: string;
};

export type OAuthToken = {
  accessToken: string;
  tokenType: "Bearer";
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  clientId?: string;
};

export type OAuthTokenStore = {
  get(subject: OAuthSubject): Promise<OAuthToken | undefined>;
  set(subject: OAuthSubject, token: OAuthToken): Promise<void>;
  delete(subject: OAuthSubject): Promise<void>;
};

export type OAuthAuthState = {
  authenticated: boolean;
  label?: string;
  expiresAt?: number;
};

export type OAuthCallbackResult = {
  code: string;
  state: string;
};

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export type OAuthRuntimeOptions = {
  tokens: OAuthTokenStore;
  fetch?: FetchLike;
  openUrl?: (url: string) => Promise<void> | void;
  waitForCallback?: (input: {
    redirectUri: string;
    state: string;
    signal?: AbortSignal;
  }) => Promise<OAuthCallbackResult>;
  generatePkce?: () => Promise<PkcePair>;
  randomState?: () => string;
  now?: () => number;
  defaultRedirectUri?: string;
};

export type OAuthRuntime = {
  status(input: OAuthSubjectInput): Promise<OAuthAuthState>;
  login(input: OAuthProviderInput): Promise<OAuthAuthState>;
  logout(input: OAuthSubjectInput): Promise<OAuthAuthState>;
  accessToken(input: OAuthProviderInput): Promise<string | undefined>;
};

export type OAuthSubjectInput = {
  subject: OAuthSubject;
  signal?: AbortSignal;
};

export type OAuthProviderInput = OAuthSubjectInput & {
  provider: OAuthProviderConfig;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const reservedAuthorizationParams = new Set([
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
]);

export function createMemoryOAuthTokenStore(): OAuthTokenStore {
  const tokens = new Map<string, OAuthToken>();
  return {
    async get(subject) {
      const token = tokens.get(oauthSubjectKey(subject));
      return token ? { ...token } : undefined;
    },
    async set(subject, token) {
      tokens.set(oauthSubjectKey(subject), { ...token });
    },
    async delete(subject) {
      tokens.delete(oauthSubjectKey(subject));
    },
  };
}

export function oauthSubjectKey(subject: OAuthSubject): string {
  return base64Url(Buffer.from(JSON.stringify([subject.target, subject.profile ?? null, subject.provider])));
}

export async function generatePkcePair(): Promise<PkcePair> {
  const verifier = base64Url(randomBytes(32));
  return { verifier, challenge: await pkceChallenge(verifier) };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  assertPkceVerifier(verifier);
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function createOAuthAuthorizationUrl(
  provider: OAuthClientProviderConfig,
  input: { state: string; codeChallenge: string; redirectUri?: string },
): URL {
  const redirectUri = input.redirectUri ?? provider.redirectUri;
  if (!redirectUri) throw new Error("OAuth provider requires redirectUri");

  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (provider.scopes && provider.scopes.length > 0) url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  for (const [key, value] of Object.entries(provider.extraParams ?? {})) {
    if (reservedAuthorizationParams.has(key)) {
      throw new Error(`OAuth extraParams cannot override reserved parameter: ${key}`);
    }
    url.searchParams.set(key, value);
  }

  return url;
}

export function createOAuthRuntime(options: OAuthRuntimeOptions): OAuthRuntime {
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? fetch;

  return {
    async status(input) {
      const token = await options.tokens.get(input.subject);
      if (!token) return { authenticated: false, label: input.subject.provider };
      return {
        authenticated: isTokenUsable(token, now()) || Boolean(token.refreshToken),
        label: input.subject.provider,
        ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      };
    },
    async login(input) {
      const redirectUri = redirectUriFor(input.provider, options);
      const provider = await resolveLoginProvider(input.provider, {
        redirectUri,
        fetcher,
        signal: input.signal,
      });
      const pkce = await (options.generatePkce ?? generatePkcePair)();
      const state = (options.randomState ?? randomState)();
      const authUrl = createOAuthAuthorizationUrl(provider, {
        state,
        codeChallenge: pkce.challenge,
        redirectUri,
      });

      if (!options.openUrl) throw new Error("OAuth login requires openUrl");
      if (!options.waitForCallback) throw new Error("OAuth login requires waitForCallback");

      await options.openUrl(authUrl.toString());
      const callback = await options.waitForCallback({ redirectUri, state, signal: input.signal });
      if (callback.state !== state) throw new Error("OAuth callback state mismatch");

      const token = await exchangeAuthorizationCode({
        provider,
        code: callback.code,
        codeVerifier: pkce.verifier,
        redirectUri,
        fetcher,
        now: now(),
        signal: input.signal,
      });
      await options.tokens.set(input.subject, tokenWithClientId(token, input.provider, provider));
      return stateFromToken(input.subject.provider, token, now());
    },
    async logout(input) {
      await options.tokens.delete(input.subject);
      return { authenticated: false, label: input.subject.provider };
    },
    async accessToken(input) {
      const token = await options.tokens.get(input.subject);
      if (!token) return undefined;
      if (isTokenUsable(token, now())) return token.accessToken;
      if (!token.refreshToken) return undefined;
      const clientId = token.clientId ?? input.provider.clientId;
      if (!clientId) return undefined;

      const refreshed = await refreshAccessToken({
        provider: { ...input.provider, clientId },
        refreshToken: token.refreshToken,
        fetcher,
        now: now(),
        signal: input.signal,
      });
      await options.tokens.set(input.subject, token.clientId ? { ...refreshed, clientId: token.clientId } : refreshed);
      return refreshed.accessToken;
    },
  };
}

async function resolveLoginProvider(
  provider: OAuthProviderConfig,
  input: { redirectUri: string; fetcher: FetchLike; signal?: AbortSignal },
): Promise<OAuthClientProviderConfig> {
  if (provider.clientId) return { ...provider, clientId: provider.clientId };
  if (!provider.registrationEndpoint) throw new Error("OAuth provider requires clientId or registrationEndpoint");

  const registered = await registerOAuthClient({
    provider,
    redirectUri: input.redirectUri,
    fetcher: input.fetcher,
    signal: input.signal,
  });
  return { ...provider, clientId: registered.clientId };
}

async function registerOAuthClient(input: {
  provider: OAuthProviderConfig;
  redirectUri: string;
  fetcher: FetchLike;
  signal?: AbortSignal;
}): Promise<{ clientId: string }> {
  if (!input.provider.registrationEndpoint) throw new Error("OAuth provider requires registrationEndpoint");

  const body = {
    client_name: input.provider.clientName ?? "clip",
    redirect_uris: [input.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(input.provider.scopes && input.provider.scopes.length > 0 ? { scope: input.provider.scopes.join(" ") } : {}),
  };
  const response = await input.fetcher(input.provider.registrationEndpoint, {
    method: "POST",
    signal: input.signal,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = (await response.json()) as unknown;
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`OAuth client registration failed with status ${response.status}`);
  }
  if (!isRecord(value) || typeof value.client_id !== "string" || value.client_id.length === 0) {
    throw new Error("OAuth client registration response requires client_id");
  }

  return { clientId: value.client_id };
}

async function exchangeAuthorizationCode(input: {
  provider: OAuthClientProviderConfig;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetcher: FetchLike;
  now: number;
  signal?: AbortSignal;
}): Promise<OAuthToken> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("client_id", input.provider.clientId);
  body.set("code_verifier", input.codeVerifier);
  return requestToken(input.provider.tokenEndpoint, body, input.fetcher, input.now, input.signal);
}

async function refreshAccessToken(input: {
  provider: OAuthClientProviderConfig;
  refreshToken: string;
  fetcher: FetchLike;
  now: number;
  signal?: AbortSignal;
}): Promise<OAuthToken> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", input.refreshToken);
  body.set("client_id", input.provider.clientId);
  return requestToken(input.provider.tokenEndpoint, body, input.fetcher, input.now, input.signal);
}

async function requestToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  fetcher: FetchLike,
  now: number,
  signal?: AbortSignal,
): Promise<OAuthToken> {
  const response = await fetcher(tokenEndpoint, {
    method: "POST",
    signal,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const value = (await response.json()) as unknown;
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`OAuth token request failed with status ${response.status}`);
  }
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("OAuth token response requires access_token");
  }

  const tokenType = typeof value.token_type === "string" ? value.token_type : "Bearer";
  if (tokenType.toLowerCase() !== "bearer") throw new Error(`Unsupported OAuth token type: ${tokenType}`);

  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : undefined;
  return {
    accessToken: value.access_token,
    tokenType: "Bearer",
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(expiresIn !== undefined ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
  };
}

function stateFromToken(provider: string, token: OAuthToken, now: number): OAuthAuthState {
  return {
    authenticated: isTokenUsable(token, now) || Boolean(token.refreshToken),
    label: provider,
    ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
  };
}

function tokenWithClientId(
  token: OAuthToken,
  configuredProvider: OAuthProviderConfig,
  resolvedProvider: OAuthClientProviderConfig,
): OAuthToken {
  return configuredProvider.registrationEndpoint ? { ...token, clientId: resolvedProvider.clientId } : token;
}

function redirectUriFor(provider: OAuthProviderConfig, options: OAuthRuntimeOptions): string {
  const redirectUri = provider.redirectUri ?? options.defaultRedirectUri;
  if (!redirectUri) throw new Error("OAuth provider requires redirectUri");
  return redirectUri;
}

function isTokenUsable(token: OAuthToken, now: number): boolean {
  return token.expiresAt === undefined || token.expiresAt > now;
}

function randomState(): string {
  return base64Url(randomBytes(32));
}

function assertPkceVerifier(verifier: string): void {
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("PKCE verifier length must be between 43 and 128 characters");
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(verifier)) {
    throw new Error("PKCE verifier contains invalid characters");
  }
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
