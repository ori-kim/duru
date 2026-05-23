import { describe, expect, test } from "bun:test";
import { createCli } from "@duru/cli-kit";
import { createGatewayCli } from "../../commands";
import { createMemoryGatewayStore } from "../../memory-store";
import { cliGateway, defaultGatewayAdapters } from "../../plugin";
import { apiAdapter } from "./index";

describe("@duru/cli-gateway api adapter", () => {
  test("discovers OpenAPI tools and executes operation ids", async () => {
    const store = createMemoryGatewayStore();
    const calls: unknown[] = [];
    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/v1/items": {
          get: {
            operationId: "listItems",
            summary: "List items",
            parameters: [{ name: "tag", in: "query", schema: { type: "string" } }],
          },
        },
      },
    };
    const adapter = apiAdapter();
    const config = adapter.schema.parse({ spec, headers: { "X-Custom-Header": "custom-from-config" } });
    const target = adapter.createTarget({
      manifest: { name: "notes-api", type: "api", config },
      config,
      context: {
        store,
        services: {
          async fetch(input: string | URL | Request, init?: RequestInit) {
            calls.push({ input: String(input), init });
            return new Response(JSON.stringify({ items: [] }), {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    });

    const catalog = await target.catalog?.({ target: "notes-api" });
    if (!catalog) throw new Error("api catalog is missing");

    const tools = await target.invoke({ argv: ["tools"] });
    const describe = await target.invoke({ argv: ["describe", "listItems"] });
    const result = await target.invoke({ argv: ["listItems", "--tag", "test-service"] });

    expect(catalog.map((tool) => tool.name)).toEqual(["listItems"]);
    expect(tools).toEqual({ ok: true, value: catalog, exitCode: 0 });
    expect(describe).toEqual({ ok: true, value: catalog[0], exitCode: 0 });
    expect(calls).toEqual([
      {
        input: "https://api.example.com/v1/items?tag=test-service",
        init: {
          method: "GET",
          signal: undefined,
          headers: { "X-Custom-Header": "custom-from-config" },
        },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { status: 200, statusText: "OK", body: { items: [] } },
      exitCode: 0,
    });
  });

  test("refreshes fetched OpenAPI specs into stored config", async () => {
    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/v1/items": {
          get: { operationId: "listItems" },
        },
      },
    };
    const calls: unknown[] = [];
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "notes-api",
          type: "api",
          config: { openapiUrl: "https://api.example.com/openapi.json" },
          timeoutMs: 30000,
        },
      ],
    });
    const gatewayOptions = {
      store,
      adapters: defaultGatewayAdapters(),
      services: {
        async fetch(input: string | URL | Request, init?: RequestInit) {
          calls.push({ input: String(input), init });
          return new Response(JSON.stringify(spec), {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
          });
        },
      },
    };
    const cli = createCli({ name: "duru" })
      .use(cliGateway(gatewayOptions))
      .route("gateway", createGatewayCli(gatewayOptions, { group: "Gateway" }));

    const result = await cli.run(["gateway", "refresh", "notes-api"], { render: false });

    expect(result.result).toEqual({ target: "notes-api", type: "api", refreshed: true, updated: true });
    expect(calls).toEqual([
      {
        input: "https://api.example.com/openapi.json",
        init: {
          method: "GET",
          signal: undefined,
        },
      },
    ]);
    expect(await store.getTarget("notes-api")).toEqual({
      name: "notes-api",
      type: "api",
      config: { openapiUrl: "https://api.example.com/openapi.json", spec },
      timeoutMs: 30000,
    });
  });
});
