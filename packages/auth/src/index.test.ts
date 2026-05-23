import { describe, expect, test } from "bun:test";
import {
  createMemoryOAuthTokenStore,
  createOAuthAuthorizationUrl,
  createOAuthRuntime,
  oauthSubjectKey,
  pkceChallenge,
} from "./index";
import type { OAuthProviderConfig } from "./index";

const provider: OAuthProviderConfig & { clientId: string } = {
  id: "test-provider",
  authorizationEndpoint: "https://auth.example.com/oauth/authorize",
  tokenEndpoint: "https://auth.example.com/oauth/token",
  clientId: "example-client",
  scopes: ["items:read", "items:write"],
  redirectUri: "http://127.0.0.1:53682/oauth/callback",
};

describe("@clip/auth", () => {
  test("creates PKCE authorization URLs and rejects reserved extra params", async () => {
    const codeChallenge = await pkceChallenge("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    const url = createOAuthAuthorizationUrl(provider, {
      state: "state-value",
      codeChallenge,
    });

    expect(url.origin).toBe("https://auth.example.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("example-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:53682/oauth/callback");
    expect(url.searchParams.get("scope")).toBe("items:read items:write");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe(codeChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    expect(() =>
      createOAuthAuthorizationUrl(
        { ...provider, extraParams: { response_type: "token" } },
        { state: "state-value", codeChallenge },
      ),
    ).toThrow("OAuth extraParams cannot override reserved parameter: response_type");
  });

  test("encodes OAuth subjects without separator collisions", () => {
    expect(oauthSubjectKey({ target: "a:b", provider: "c" })).not.toBe(
      oauthSubjectKey({ target: "a", profile: "b", provider: "c" }),
    );
    expect(oauthSubjectKey({ target: "notes-api", profile: "dev", provider: "test-provider" })).toBe(
      oauthSubjectKey({ target: "notes-api", profile: "dev", provider: "test-provider" }),
    );
  });

  test("runs login, status, access token, and logout through injected services", async () => {
    const opened: string[] = [];
    const requests: Array<{ input: string; body: string | undefined }> = [];
    const store = createMemoryOAuthTokenStore();
    const runtime = createOAuthRuntime({
      tokens: store,
      now: () => 1000,
      generatePkce: async () => ({ verifier: "verifier-value", challenge: "challenge-value" }),
      randomState: () => "state-value",
      openUrl: async (url) => {
        opened.push(url);
      },
      waitForCallback: async () => ({ code: "code-value", state: "state-value" }),
      fetch: async (input, init) => {
        requests.push({ input: String(input), body: String(init?.body) });
        return jsonResponse({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 60 });
      },
    });
    const subject = { target: "notes-api", profile: "dev", provider: "test-provider" };

    const login = await runtime.login({ subject, provider });
    const status = await runtime.status({ subject });
    const accessToken = await runtime.accessToken({ subject, provider });
    await runtime.logout({ subject });
    const loggedOut = await runtime.status({ subject });

    expect(login).toEqual({ authenticated: true, label: "test-provider", expiresAt: 61000 });
    expect(status).toEqual({ authenticated: true, label: "test-provider", expiresAt: 61000 });
    expect(accessToken).toBe("access-token");
    expect(loggedOut).toEqual({ authenticated: false, label: "test-provider" });
    expect(opened[0]).toContain("code_challenge=challenge-value");
    expect(requests).toEqual([
      {
        input: "https://auth.example.com/oauth/token",
        body: "grant_type=authorization_code&code=code-value&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Foauth%2Fcallback&client_id=example-client&code_verifier=verifier-value",
      },
    ]);
  });

  test("refreshes expired access tokens when a refresh token is available", async () => {
    const store = createMemoryOAuthTokenStore();
    await store.set(
      { target: "notes-api", provider: "test-provider" },
      {
        accessToken: "old-token",
        tokenType: "Bearer",
        refreshToken: "refresh-token",
        expiresAt: 1000,
      },
    );
    const requests: string[] = [];
    const runtime = createOAuthRuntime({
      tokens: store,
      now: () => 2000,
      fetch: async (_input, init) => {
        requests.push(String(init?.body));
        return jsonResponse({ access_token: "new-token", refresh_token: "new-refresh-token", expires_in: 30 });
      },
    });

    const token = await runtime.accessToken({
      subject: { target: "notes-api", provider: "test-provider" },
      provider,
    });

    expect(token).toBe("new-token");
    expect(requests).toEqual(["grant_type=refresh_token&refresh_token=refresh-token&client_id=example-client"]);
    expect(await store.get({ target: "notes-api", provider: "test-provider" })).toEqual({
      accessToken: "new-token",
      tokenType: "Bearer",
      refreshToken: "new-refresh-token",
      expiresAt: 32000,
    });
  });

  test("registers dynamic OAuth clients for the current redirect uri", async () => {
    const opened: string[] = [];
    const requests: Array<{ input: string; body: string | undefined }> = [];
    const store = createMemoryOAuthTokenStore();
    const runtime = createOAuthRuntime({
      tokens: store,
      now: () => 1000,
      defaultRedirectUri: "http://127.0.0.1:53682/oauth/callback",
      generatePkce: async () => ({ verifier: "verifier-value", challenge: "challenge-value" }),
      randomState: () => "state-value",
      openUrl: async (url) => {
        opened.push(url);
      },
      waitForCallback: async () => ({ code: "code-value", state: "state-value" }),
      fetch: async (input, init) => {
        requests.push({ input: String(input), body: String(init?.body) });
        if (String(input) === "https://auth.example.com/oauth/register") {
          return jsonResponse({ client_id: "registered-client" });
        }
        return jsonResponse({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 60 });
      },
    });
    const subject = { target: "notes-api", provider: "test-provider" };

    const login = await runtime.login({
      subject,
      provider: {
        id: "test-provider",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        registrationEndpoint: "https://auth.example.com/oauth/register",
        scopes: ["items:read"],
      },
    });

    expect(login).toEqual({ authenticated: true, label: "test-provider", expiresAt: 61000 });
    expect(new URL(opened[0] ?? "").searchParams.get("client_id")).toBe("registered-client");
    expect(requests).toEqual([
      {
        input: "https://auth.example.com/oauth/register",
        body: JSON.stringify({
          client_name: "clip",
          redirect_uris: ["http://127.0.0.1:53682/oauth/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "items:read",
        }),
      },
      {
        input: "https://auth.example.com/oauth/token",
        body: "grant_type=authorization_code&code=code-value&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2Foauth%2Fcallback&client_id=registered-client&code_verifier=verifier-value",
      },
    ]);
    expect(await store.get(subject)).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      refreshToken: "refresh-token",
      expiresAt: 61000,
      clientId: "registered-client",
    });
  });

  test("refreshes dynamic OAuth tokens with their registered client id", async () => {
    const store = createMemoryOAuthTokenStore();
    await store.set(
      { target: "notes-api", provider: "test-provider" },
      {
        accessToken: "old-token",
        tokenType: "Bearer",
        refreshToken: "refresh-token",
        expiresAt: 1000,
        clientId: "registered-client",
      },
    );
    const requests: string[] = [];
    const runtime = createOAuthRuntime({
      tokens: store,
      now: () => 2000,
      fetch: async (_input, init) => {
        requests.push(String(init?.body));
        return jsonResponse({ access_token: "new-token", refresh_token: "new-refresh-token", expires_in: 30 });
      },
    });

    const token = await runtime.accessToken({
      subject: { target: "notes-api", provider: "test-provider" },
      provider: {
        id: "test-provider",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        registrationEndpoint: "https://auth.example.com/oauth/register",
      },
    });

    expect(token).toBe("new-token");
    expect(requests).toEqual(["grant_type=refresh_token&refresh_token=refresh-token&client_id=registered-client"]);
    expect(await store.get({ target: "notes-api", provider: "test-provider" })).toEqual({
      accessToken: "new-token",
      tokenType: "Bearer",
      refreshToken: "new-refresh-token",
      expiresAt: 32000,
      clientId: "registered-client",
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}
