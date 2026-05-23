import { describe, expect, test } from "bun:test";
import { apiAdapter } from "./adapters/api";
import { parseOptionalOAuthProviderConfig } from "./auth";
import { createMemoryGatewayStore } from "./memory-store";

describe("@duru/cli-gateway oauth auth provider integration", () => {
  test("parses optional OAuth token store selection", () => {
    expect(parseOptionalOAuthProviderConfig("oauth")).toBeUndefined();

    expect(
      parseOptionalOAuthProviderConfig({
        provider: "test-provider",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        registrationEndpoint: "https://auth.example.com/oauth/register",
        store: "file",
      }),
    ).toMatchObject({
      provider: "test-provider",
      registrationEndpoint: "https://auth.example.com/oauth/register",
      store: "file",
    });

    expect(() =>
      parseOptionalOAuthProviderConfig({
        provider: "test-provider",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "example-client",
        store: "memory",
      }),
    ).toThrow("Invalid auth config: store must be keychain or file");
  });

  test("adds oauth auth hooks and injects bearer tokens into api requests", async () => {
    const calls: unknown[] = [];
    const oauthCalls: unknown[] = [];
    const store = createMemoryGatewayStore();
    const adapter = apiAdapter();
    const config = adapter.schema.parse({
      baseUrl: "https://api.example.com",
      auth: {
        provider: "test-provider",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        clientId: "example-client",
      },
    });
    const target = adapter.createTarget({
      manifest: { name: "notes-api", type: "api", config },
      config,
      context: {
        store,
        services: {
          oauth: {
            async status(input: unknown) {
              oauthCalls.push({ action: "status", input });
              return { authenticated: true, label: "test-provider" };
            },
            async login(input: unknown) {
              oauthCalls.push({ action: "login", input });
              return { authenticated: true, label: "test-provider" };
            },
            async logout(input: unknown) {
              oauthCalls.push({ action: "logout", input });
              return { authenticated: false, label: "test-provider" };
            },
            async accessToken(input: unknown) {
              oauthCalls.push({ action: "accessToken", input });
              return "access-token";
            },
          },
          async fetch(input: string | URL | Request, init?: RequestInit) {
            calls.push({ input: String(input), init });
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    });

    const status = await target.auth?.status?.({ target: "notes-api" });
    const login = await target.auth?.login?.({ target: "notes-api" });
    const logout = await target.auth?.logout?.({ target: "notes-api" });
    const result = await target.invoke({ argv: ["GET", "/v1/items"] });

    expect(status).toEqual({ authenticated: true, label: "test-provider" });
    expect(login).toEqual({ authenticated: true, label: "test-provider" });
    expect(logout).toEqual({ authenticated: false, label: "test-provider" });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        input: "https://api.example.com/v1/items",
        init: {
          method: "GET",
          signal: undefined,
          headers: { authorization: "Bearer access-token" },
        },
      },
    ]);
    expect(oauthCalls).toEqual([
      {
        action: "status",
        input: {
          subject: { target: "notes-api", provider: "test-provider" },
          provider: config.auth,
        },
      },
      {
        action: "login",
        input: {
          subject: { target: "notes-api", provider: "test-provider" },
          provider: config.auth,
        },
      },
      {
        action: "logout",
        input: {
          subject: { target: "notes-api", provider: "test-provider" },
          provider: config.auth,
        },
      },
      {
        action: "accessToken",
        input: {
          subject: { target: "notes-api", provider: "test-provider" },
          provider: config.auth,
        },
      },
    ]);
  });
});
