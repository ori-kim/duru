import { join } from "path";

// --- 타입 ---

type StoredAuth = {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // Unix epoch ms
  scope?: string;
  client_id: string;
  client_secret?: string;
  authorization_server: string;
  token_endpoint: string;
  authorization_endpoint: string;
  registration_endpoint?: string;
  resource_url: string;
};

type ResourceMetadata = {
  resource: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
};

type ASMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
};

type ClientRegistration = {
  client_id: string;
  client_secret?: string;
};

type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

// --- 토큰 저장/로드 ---

function authPath(configDir: string): string {
  return join(configDir, "auth.json");
}

async function loadAuth(configDir: string): Promise<StoredAuth | null> {
  const path = authPath(configDir);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const text = await file.text();
    return JSON.parse(text) as StoredAuth;
  } catch {
    return null;
  }
}

async function saveAuth(configDir: string, auth: StoredAuth): Promise<void> {
  await Bun.spawn(["mkdir", "-p", configDir]).exited;
  const path = authPath(configDir);
  await Bun.write(path, JSON.stringify(auth, null, 2));
  await Bun.spawn(["chmod", "600", path]).exited;
}

async function deleteAuth(configDir: string): Promise<void> {
  const path = authPath(configDir);
  await Bun.spawn(["rm", "-f", path]).exited;
}

// --- PKCE ---

function base64UrlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const verifier = base64UrlEncode(raw);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(hash));
  return { verifier, challenge };
}

// --- OAuth Discovery ---

function parseResourceMetadataUrl(resp: Response): string | undefined {
  const header = resp.headers.get("WWW-Authenticate") ?? "";
  const match = header.match(/resource_metadata="([^"]+)"/);
  return match?.[1];
}

async function fetchResourceMetadata(serverUrl: string, hintUrl?: string): Promise<ResourceMetadata> {
  if (hintUrl) {
    try {
      const resp = await fetch(hintUrl);
      if (resp.ok) return (await resp.json()) as ResourceMetadata;
    } catch {
      // fallback으로
    }
  }

  const { origin, pathname } = new URL(serverUrl);
  const candidates = [`${origin}/.well-known/oauth-protected-resource`];
  if (pathname && pathname !== "/") {
    candidates.unshift(`${origin}/.well-known/oauth-protected-resource${pathname}`);
  }
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return (await resp.json()) as ResourceMetadata;
    } catch {
      // try next
    }
  }
  throw new Error(`Failed to discover OAuth protected resource metadata for ${serverUrl}`);
}

async function fetchASMetadata(authServer: string): Promise<ASMetadata> {
  const base = authServer.replace(/\/$/, "");
  for (const suffix of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    try {
      const resp = await fetch(`${base}${suffix}`);
      if (resp.ok) return (await resp.json()) as ASMetadata;
    } catch {
      // 다음 시도
    }
  }
  throw new Error(`Failed to fetch authorization server metadata from ${authServer}`);
}

// --- Dynamic Client Registration ---

async function registerClient(registrationEndpoint: string, callbackPort: number): Promise<ClientRegistration> {
  const resp = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "clip",
      redirect_uris: [`http://localhost:${callbackPort}/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!resp.ok) {
    throw new Error(`OAuth client registration failed: ${await resp.text()}`);
  }
  return (await resp.json()) as ClientRegistration;
}

// --- Callback Server ---

const HTML_SUCCESS = `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>✓ 인증 완료</h1><p>이 탭을 닫고 터미널로 돌아가세요.</p></body></html>`;

function htmlError(msg: string): string {
  return `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
<h1>✗ 인증 실패</h1><p>${msg}</p></body></html>`;
}

function startCallbackServer(expectedState: string): {
  port: number;
  codePromise: Promise<string>;
} {
  let resolve!: (code: string) => void;
  let reject!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timeout = setTimeout(() => {
    reject(new Error("OAuth callback timed out after 120 seconds"));
    server.stop();
  }, 120_000);

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        clearTimeout(timeout);
        reject(new Error(`OAuth error: ${desc}`));
        server.stop();
        return new Response(htmlError(desc), { headers: { "Content-Type": "text/html" } });
      }

      const state = url.searchParams.get("state");
      if (state !== expectedState) {
        return new Response("State mismatch", { status: 400 });
      }

      const code = url.searchParams.get("code");
      if (!code) {
        return new Response("Missing code", { status: 400 });
      }

      clearTimeout(timeout);
      resolve(code);
      server.stop();
      return new Response(HTML_SUCCESS, { headers: { "Content-Type": "text/html" } });
    },
  });

  return { port: server.port!, codePromise };
}

// --- Token Exchange ---

async function exchangeCode(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientSecret?: string,
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  if (clientSecret) params.set("client_secret", clientSecret);

  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!resp.ok) {
    throw new Error(`OAuth token exchange failed: ${await resp.text()}`);
  }
  return (await resp.json()) as TokenResponse;
}

// --- Token Refresh ---

async function doRefresh(stored: StoredAuth): Promise<TokenResponse | null> {
  if (!stored.refresh_token) return null;

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
    client_id: stored.client_id,
  });
  if (stored.client_secret) params.set("client_secret", stored.client_secret);

  try {
    const resp = await fetch(stored.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as TokenResponse;
  } catch {
    return null;
  }
}

// --- Full OAuth Flow ---

async function runFullOAuthFlow(
  targetName: string,
  serverUrl: string,
  configDir: string,
  resp401?: Response,
): Promise<StoredAuth> {
  const hintUrl = resp401 ? parseResourceMetadataUrl(resp401) : undefined;
  const resourceMeta = await fetchResourceMetadata(serverUrl, hintUrl);

  const authServerUrl = resourceMeta.authorization_servers?.[0];
  if (!authServerUrl) {
    throw new Error(`OAuth: No authorization server found for ${serverUrl}`);
  }

  const asMeta = await fetchASMetadata(authServerUrl);

  const stateRaw = new Uint8Array(16);
  crypto.getRandomValues(stateRaw);
  const state = base64UrlEncode(stateRaw);

  const { port, codePromise } = startCallbackServer(state);
  const redirectUri = `http://localhost:${port}/callback`;

  let clientId: string;
  let clientSecret: string | undefined;

  const existing = await loadAuth(configDir);
  if (existing?.client_id && existing.authorization_server === authServerUrl) {
    clientId = existing.client_id;
    clientSecret = existing.client_secret;
  } else if (asMeta.registration_endpoint) {
    const reg = await registerClient(asMeta.registration_endpoint, port);
    clientId = reg.client_id;
    clientSecret = reg.client_secret;
  } else {
    throw new Error(`OAuth: Server requires pre-registered client. Use 'headers' in config.yml instead.`);
  }

  const pkce = await generatePKCE();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  });
  if (resourceMeta.scopes_supported?.length) {
    params.set("scope", resourceMeta.scopes_supported.join(" "));
  }

  const authUrl = `${asMeta.authorization_endpoint}?${params}`;

  const link = `\x1b]8;;${authUrl}\x07${authUrl}\x1b]8;;\x07`;
  process.stderr.write(`\x1b[0m\nclip: 로그인이 필요합니다.\n  ${link}\n\n\x1b[0m`);

  const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([openCmd, authUrl], { stdout: "ignore", stderr: "ignore" });

  let code: string;
  try {
    code = await codePromise;
  } catch (e) {
    throw new Error(`OAuth: ${e instanceof Error ? e.message : String(e)}`);
  }

  const tokens = await exchangeCode(asMeta.token_endpoint, clientId, code, redirectUri, pkce.verifier, clientSecret);

  const auth: StoredAuth = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600_000,
    scope: tokens.scope,
    client_id: clientId,
    client_secret: clientSecret,
    authorization_server: authServerUrl,
    token_endpoint: asMeta.token_endpoint,
    authorization_endpoint: asMeta.authorization_endpoint,
    registration_endpoint: asMeta.registration_endpoint,
    resource_url: serverUrl,
  };

  await saveAuth(configDir, auth);
  process.stderr.write(`\x1b[0mclip: 로그인 완료.\n\x1b[0m`);

  return auth;
}

// --- Export 함수 ---

/** 저장된 토큰으로 Authorization 헤더 반환. 없거나 만료되면 null. */
export async function getStoredAuthHeaders(
  configDir: string,
): Promise<Record<string, string> | null> {
  const auth = await loadAuth(configDir);
  if (!auth) return null;
  if (Date.now() >= auth.expires_at) return null;
  return { Authorization: `Bearer ${auth.access_token}` };
}

/** 만료 5분 전이면 refresh 시도. 새 헤더 반환 또는 null. */
export async function refreshIfExpiring(
  configDir: string,
): Promise<Record<string, string> | null> {
  const auth = await loadAuth(configDir);
  if (!auth) return null;

  const FIVE_MINUTES = 5 * 60 * 1000;
  if (Date.now() < auth.expires_at - FIVE_MINUTES) return null;

  const tokens = await doRefresh(auth);
  if (!tokens) return null;

  const updated: StoredAuth = {
    ...auth,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? auth.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600_000,
    scope: tokens.scope ?? auth.scope,
  };
  await saveAuth(configDir, updated);
  return { Authorization: `Bearer ${updated.access_token}` };
}

/**
 * 401 응답 처리: refresh 시도 → 실패 시 전체 OAuth 플로우.
 * 항상 유효한 Authorization 헤더를 반환한다.
 */
export async function handleOAuth401(
  targetName: string,
  serverUrl: string,
  resp: Response,
  configDir: string,
): Promise<Record<string, string>> {
  const stored = await loadAuth(configDir);
  if (stored?.refresh_token) {
    const tokens = await doRefresh(stored);
    if (tokens) {
      const updated: StoredAuth = {
        ...stored,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? stored.refresh_token,
        expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600_000,
        scope: tokens.scope ?? stored.scope,
      };
      await saveAuth(configDir, updated);
      return { Authorization: `Bearer ${updated.access_token}` };
    }
    await deleteAuth(configDir);
  }

  const auth = await runFullOAuthFlow(targetName, serverUrl, configDir, resp);
  return { Authorization: `Bearer ${auth.access_token}` };
}

/**
 * 공개 alias: runFullOAuthFlow를 외부에서 사용할 수 있도록 노출한다.
 * @clip/auth index.ts의 runOAuthFlow export에 대응한다.
 */
export async function runOAuthFlow(
  targetName: string,
  serverUrl: string,
  configDir: string,
  resp401?: Response,
): Promise<void> {
  await runFullOAuthFlow(targetName, serverUrl, configDir, resp401);
}

/** login 명령용: 전체 OAuth 플로우 강제 실행 */
export async function forceLogin(targetName: string, serverUrl: string, configDir: string): Promise<void> {
  await deleteAuth(configDir);
  await runFullOAuthFlow(targetName, serverUrl, configDir);
}

/** logout 명령용: 토큰 파일 삭제 */
export async function removeTokens(configDir: string): Promise<void> {
  await deleteAuth(configDir);
}

/** list 출력용: 토큰 존재 여부와 만료 상태 반환 */
export async function getAuthStatus(configDir: string): Promise<string | null> {
  const auth = await loadAuth(configDir);
  if (!auth) return null;

  const now = Date.now();
  if (now >= auth.expires_at) return "token expired";

  const remaining = auth.expires_at - now;
  const mins = Math.floor(remaining / 60_000);
  if (mins < 60) return `authenticated, expires in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `authenticated, expires in ${hours}h`;
}
