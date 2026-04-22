import { getStoredAuthHeaders, getAuthStatus, handleOAuth401, refreshIfExpiring } from "./oauth.ts";

/**
 * AuthenticatedClient — OAuth 토큰을 자동으로 주입하고 401 시 재인증하는 HTTP 클라이언트.
 *
 * 각 HTTP protocol executor가 이 클래스를 통해 모든 outbound HTTP 요청을 보낸다.
 * target.auth === "oauth" 일 때만 토큰 주입이 활성화된다.
 */
export class AuthenticatedClient {
  private readonly configDir: string;
  private readonly oauthEnabled: boolean;
  private readonly serverUrl: string;
  private readonly targetName: string;

  constructor(opts: {
    targetName: string;
    /** target type: "mcp" | "api" | "graphql" */
    targetType: string;
    /** 실제 요청 대상 URL (base URL 또는 endpoint) */
    serverUrl: string;
    /** target.auth === "oauth" 여부 */
    oauthEnabled: boolean;
    /** resolveAuthDir(targetName, targetType)로 계산한 configDir */
    configDir: string;
  }) {
    this.targetName = opts.targetName;
    this.serverUrl = opts.serverUrl;
    this.oauthEnabled = opts.oauthEnabled;
    this.configDir = opts.configDir;
  }

  /**
   * 만료 임박 토큰을 사전 갱신하고 현재 유효한 Authorization 헤더를 반환한다.
   * OAuth가 비활성화된 경우 빈 객체를 반환한다.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this.oauthEnabled) return {};

    const refreshed = await refreshIfExpiring(this.configDir);
    if (refreshed) return refreshed;

    const stored = await getStoredAuthHeaders(this.configDir);
    return stored ?? {};
  }

  /**
   * fetch 래퍼: 자동 토큰 주입 + 401 시 OAuth 플로우 트리거 후 1회 재시도.
   */
  async fetch(url: string, init?: RequestInit, isRetry = false): Promise<Response> {
    if (!this.oauthEnabled) {
      return fetch(url, init);
    }

    if (!isRetry) {
      const authHeaders = await this.getAuthHeaders();
      if (Object.keys(authHeaders).length > 0) {
        init = { ...init, headers: { ...(init?.headers as Record<string, string> ?? {}), ...authHeaders } };
      }
    }

    const resp = await fetch(url, init);

    if (resp.status === 401 && !isRetry) {
      const authHeaders = await handleOAuth401(this.targetName, this.serverUrl, resp, this.configDir);
      const mergedHeaders = { ...(init?.headers as Record<string, string> ?? {}), ...authHeaders };
      return this.fetch(url, { ...init, headers: mergedHeaders }, true);
    }

    return resp;
  }

  /**
   * gRPC 토큰 취득: grpcurl の -rpc-header / -reflect-header 에 직접 주입할 토큰 문자열을 반환.
   * OAuth 비활성화 시 undefined.
   */
  async getToken(): Promise<string | undefined> {
    if (!this.oauthEnabled) return undefined;

    const refreshed = await refreshIfExpiring(this.configDir);
    if (refreshed?.["Authorization"]) return refreshed["Authorization"].replace(/^Bearer\s+/i, "");

    const stored = await getStoredAuthHeaders(this.configDir);
    return stored?.["Authorization"]?.replace(/^Bearer\s+/i, "");
  }

  /** getAuthStatus 위임 — list 렌더러에서 사용 */
  static async getAuthStatus(configDir: string): Promise<string | null> {
    return getAuthStatus(configDir);
  }
}
