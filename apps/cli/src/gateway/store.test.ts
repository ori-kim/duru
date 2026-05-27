import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "@duru/file-store";
import { withGatewayCatalogCache } from "./catalog-store";
import { createAppGatewayStore } from "./store";

describe("app gateway store", () => {
  test("hydrates legacy oauth sidecar metadata for mcp targets", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-gateway-store-"));
    const files = createFileStore({ root: join(home, "gateway") });
    const store = createAppGatewayStore({ files });

    await files.write("mcp/notes-mcp/config.yml", {
      name: "notes-mcp",
      type: "mcp",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      auth: "oauth",
    });
    await files.write("mcp/notes-mcp/auth.json", {
      access_token: "legacy-access-token",
      refresh_token: "legacy-refresh-token",
      expires_at: 1234,
      scope: "items:read items:write",
      client_id: "example-client",
      authorization_server: "https://auth.example.com",
      token_endpoint: "https://auth.example.com/oauth/token",
      authorization_endpoint: "https://auth.example.com/oauth/authorize",
      registration_endpoint: "https://auth.example.com/oauth/register",
      resource_url: "https://mcp.example.com/mcp",
    });

    const target = await store.getTarget("notes-mcp");

    expect(target?.config).toEqual({
      transport: "http",
      url: "https://mcp.example.com/mcp",
      auth: {
        provider: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        registrationEndpoint: "https://auth.example.com/oauth/register",
        scopes: ["items:read", "items:write"],
      },
    });
  });

  test("persists discovered oauth provider metadata as a target sidecar", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-gateway-store-"));
    const files = createFileStore({ root: join(home, "gateway") });
    const store = createAppGatewayStore({ files });
    const provider = {
      id: "https://auth.example.com",
      provider: "https://auth.example.com",
      authorizationEndpoint: "https://auth.example.com/oauth/authorize",
      tokenEndpoint: "https://auth.example.com/oauth/token",
      registrationEndpoint: "https://auth.example.com/oauth/register",
      clientName: "Duru",
      scopes: ["items:read", "items:write"],
      extraParams: { resource: "https://mcp.example.com/mcp" },
    };

    await store.saveTargetWithSidecars?.(
      {
        name: "notes-mcp",
        type: "mcp",
        config: {
          url: "https://mcp.example.com/mcp",
          auth: provider,
        },
      },
      { oauth: provider },
    );

    expect(await files.read<Record<string, unknown>>("mcp/notes-mcp/config.toml")).toEqual({
      name: "notes-mcp",
      type: "mcp",
      config: {
        url: "https://mcp.example.com/mcp",
        auth: "oauth",
      },
    });
    expect(await files.read<Record<string, unknown>>("mcp/notes-mcp/auth.json")).toEqual({
      authorization_server: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/oauth/authorize",
      token_endpoint: "https://auth.example.com/oauth/token",
      registration_endpoint: "https://auth.example.com/oauth/register",
      client_name: "Duru",
      scope: "items:read items:write",
      resource_url: "https://mcp.example.com/mcp",
      extraParams: { resource: "https://mcp.example.com/mcp" },
    });
    expect((await store.getTarget("notes-mcp"))?.config).toEqual({
      url: "https://mcp.example.com/mcp",
      auth: {
        provider: "https://auth.example.com",
        authorizationEndpoint: "https://auth.example.com/oauth/authorize",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        registrationEndpoint: "https://auth.example.com/oauth/register",
        clientName: "Duru",
        scopes: ["items:read", "items:write"],
        extraParams: { resource: "https://mcp.example.com/mcp" },
      },
    });
  });

  test("persists catalog cache records next to gateway config", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-gateway-store-"));
    const files = createFileStore({ root: join(home, "gateway") });
    const store = withGatewayCatalogCache(createAppGatewayStore({ files }), files);

    await store.saveCatalog?.({
      target: "notes-api",
      operations: [{ name: "listItems", description: "List items" }],
      refreshedAt: "2026-05-23T00:00:00.000Z",
    });

    const catalog = await store.getCatalog?.("notes-api");
    const catalogs = await store.listCatalogs?.();

    expect(catalog).toEqual({
      target: "notes-api",
      operations: [{ name: "listItems", description: "List items" }],
      refreshedAt: "2026-05-23T00:00:00.000Z",
      source: { path: files.resolve("_catalogs/notes-api.json"), format: "json" },
    });
    expect(catalogs?.map((item) => item.target)).toEqual(["notes-api"]);
  });
});
