import { homedir } from "os";
import { join } from "path";
import { die } from "./errors.ts";

// --- 경로 ---

const CLIP_DIR = join(homedir(), ".clip");

type AuthKind = "mcp" | "api" | "grpc";

function authDirOf(targetName: string, kind: AuthKind = "mcp"): string {
  return join(CLIP_DIR, "target", kind, targetName);
}

function authPath(targetName: string, kind: AuthKind = "mcp"): string {
  return join(authDirOf(targetName, kind), "auth.json");
}

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

async function loadAuth(targetName: string, kind: AuthKind = "mcp"): Promise<StoredAuth | null> {
  const path = authPath(targetName, kind);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const text = await file.text();
    return JSON.parse(text) as StoredAuth;
  } catch {
    return null;
  }
}

async function saveAuth(targetName: string, auth: StoredAuth, kind: AuthKind = "mcp"): Promise<void> {
  const dir = authDirOf(targetName, kind);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  const path = authPath(targetName, kind);
  await Bun.write(path, JSON.stringify(auth, null, 2));
  await Bun.spawn(["chmod", "600", path]).exited;
}

async function deleteAuth(targetName: string, kind: AuthKind = "mcp"): Promise<void> {
  const path = authPath(targetName, kind);
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
  // hint URL 우선 (WWW-Authenticate 헤더에서 추출)
  if (hintUrl) {
    try {
      const resp = await fetch(hintUrl);
      if (resp.ok) return (await resp.json()) as ResourceMetadata;
    } catch {
      // fallback으로
    }
  }

  // fallback: /.well-known/oauth-protected-resource
  const origin = new URL(serverUrl).origin;
  const resp = await fetch(`${origin}/.well-known/oauth-protected-resource`);
  if (!resp.ok) {
    die(`Failed to discover OAuth protected resource metadata for ${serverUrl}`);
  }
  return (await resp.json()) as ResourceMetadata;
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
  die(`Failed to fetch authorization server metadata from ${authServer}`);
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
    die(`OAuth client registration failed: ${await resp.text()}`);
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

  // Bun.serve({ port: 0 })는 항상 포트를 할당하므로 non-null 보장
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
    die(`OAuth token exchange failed: ${await resp.text()}`);
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

async function runFullOAuthFlow(targetName: string, serverUrl: string, resp401?: Response, kind: AuthKind = "mcp"): Promise<StoredAuth> {
  // 1. Protected Resource Metadata 조회
  const hintUrl = resp401 ? parseResourceMetadataUrl(resp401) : undefined;
  const resourceMeta = await fetchResourceMetadata(serverUrl, hintUrl);

  const authServerUrl = resourceMeta.authorization_servers?.[0];
  if (!authServerUrl) {
    die(`OAuth: No authorization server found for ${serverUrl}`);
  }

  // 2. Authorization Server Metadata 조회
  const asMeta = await fetchASMetadata(authServerUrl);

  // 3. Callback 서버 시작
  const stateRaw = new Uint8Array(16);
  crypto.getRandomValues(stateRaw);
  const state = base64UrlEncode(stateRaw);

  const { port, codePromise } = startCallbackServer(state);
  const redirectUri = `http://localhost:${port}/callback`;

  // 4. Client Registration (저장된 client_id 없을 때)
  let clientId: string;
  let clientSecret: string | undefined;

  const existing = await loadAuth(targetName, kind);
  if (existing?.client_id && existing.authorization_server === authServerUrl) {
    clientId = existing.client_id;
    clientSecret = existing.client_secret;
  } else if (asMeta.registration_endpoint) {
    const reg = await registerClient(asMeta.registration_endpoint, port);
    clientId = reg.client_id;
    clientSecret = reg.client_secret;
  } else {
    die(`OAuth: Server requires pre-registered client. Use 'headers' in config.yml instead.`);
  }

  // 5. PKCE 생성
  const pkce = await generatePKCE();

  // 6. Authorization URL 구성 + 브라우저 열기
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

  // OSC 8 터미널 하이퍼링크 (iTerm2, Ghostty, WezTerm 등 지원)
  const link = `\x1b]8;;${authUrl}\x07${authUrl}\x1b]8;;\x07`;
  process.stderr.write(`\x1b[0m\nclip: 로그인이 필요합니다.\n  ${link}\n\n\x1b[0m`);

  const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([openCmd, authUrl], { stdout: "ignore", stderr: "ignore" });

  // 7. 콜백 대기
  let code: string;
  try {
    code = await codePromise;
  } catch (e) {
    die(`OAuth: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 8. 토큰 교환
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

  // 9. 저장
  await saveAuth(targetName, auth, kind);
  process.stderr.write(`\x1b[0mclip: 로그인 완료.\n\x1b[0m`);

  return auth;
}

// --- Export 함수 ---

/** 저장된 토큰으로 Authorization 헤더 반환. 없거나 만료되면 null. */
export async function getStoredAuthHeaders(targetName: string, kind: AuthKind = "mcp"): Promise<Record<string, string> | null> {
  const auth = await loadAuth(targetName, kind);
  if (!auth) return null;
  // 만료된 토큰은 null 반환 (호출부에서 401로 처리)
  if (Date.now() >= auth.expires_at) return null;
  return { Authorization: `Bearer ${auth.access_token}` };
}

/** 만료 5분 전이면 refresh 시도. 새 헤더 반환 또는 null. */
export async function refreshIfExpiring(targetName: string, kind: AuthKind = "mcp"): Promise<Record<string, string> | null> {
  const auth = await loadAuth(targetName, kind);
  if (!auth) return null;

  const FIVE_MINUTES = 5 * 60 * 1000;
  if (Date.now() < auth.expires_at - FIVE_MINUTES) return null; // 아직 여유 있음

  const tokens = await doRefresh(auth);
  if (!tokens) return null;

  const updated: StoredAuth = {
    ...auth,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? auth.refresh_token,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600_000,
    scope: tokens.scope ?? auth.scope,
  };
  await saveAuth(targetName, updated, kind);
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
  kind: AuthKind = "mcp",
): Promise<Record<string, string>> {
  // refresh_token으로 갱신 먼저 시도
  const stored = await loadAuth(targetName, kind);
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
      await saveAuth(targetName, updated, kind);
      return { Authorization: `Bearer ${updated.access_token}` };
    }
    // refresh 실패 → 저장 토큰 삭제 후 재인증
    await deleteAuth(targetName, kind);
  }

  // 전체 OAuth 플로우
  const auth = await runFullOAuthFlow(targetName, serverUrl, resp, kind);
  return { Authorization: `Bearer ${auth.access_token}` };
}

/** login 명령용: 전체 OAuth 플로우 강제 실행 */
export async function forceLogin(targetName: string, serverUrl: string, kind: AuthKind = "mcp"): Promise<void> {
  await deleteAuth(targetName, kind); // 기존 토큰 삭제 후 새로 인증
  await runFullOAuthFlow(targetName, serverUrl, undefined, kind);
}

/** logout 명령용: 토큰 파일 삭제 */
export async function removeTokens(targetName: string, kind: AuthKind = "mcp"): Promise<void> {
  await deleteAuth(targetName, kind);
}

/** list 출력용: 토큰 존재 여부와 만료 상태 반환 */
export async function getAuthStatus(targetName: string, kind: AuthKind = "mcp"): Promise<string | null> {
  const auth = await loadAuth(targetName, kind);
  if (!auth) return null;

  const now = Date.now();
  if (now >= auth.expires_at) return "token expired";

  const remaining = auth.expires_at - now;
  const mins = Math.floor(remaining / 60_000);
  if (mins < 60) return `authenticated, expires in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return `authenticated, expires in ${hours}h`;
}

export type { AuthKind };
