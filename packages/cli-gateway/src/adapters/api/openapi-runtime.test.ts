import { describe, expect, test } from "bun:test";
import { createMemoryGatewayStore } from "../../memory-store";
import { apiAdapter } from "./index";

describe("@duru/cli-gateway OpenAPI runtime", () => {
  test("accepts JSON object input through --input for operation parameters", async () => {
    const calls: RequestCall[] = [];
    const target = createApiTarget({
      spec: {
        openapi: "3.0.0",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/v1/items": {
            post: {
              operationId: "createItem",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { name: { type: "string" }, tag: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      calls,
    });

    await target.invoke({
      argv: ["createItem", "--input", '{"name":"example","tag":"test-service"}'],
    });

    expect(calls[0]?.init.body).toBe(JSON.stringify({ name: "example", tag: "test-service" }));
  });

  test("encodes OpenAPI form urlencoded request bodies", async () => {
    const calls: RequestCall[] = [];
    const target = createApiTarget({
      spec: {
        openapi: "3.0.0",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/v1/items": {
            post: {
              operationId: "createItem",
              requestBody: {
                content: {
                  "application/x-www-form-urlencoded": {
                    schema: {
                      type: "object",
                      properties: { name: { type: "string" }, tag: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      calls,
    });

    await target.invoke({ argv: ["createItem", "--name", "example", "--tag", "test-service"] });

    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(String(body)).toBe("name=example&tag=test-service");
    expect(calls[0]?.init.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
  });

  test("encodes OpenAPI multipart request bodies without forcing a content-type boundary", async () => {
    const calls: RequestCall[] = [];
    const target = createApiTarget({
      spec: {
        openapi: "3.0.0",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/v1/items": {
            post: {
              operationId: "createItem",
              requestBody: {
                content: {
                  "multipart/form-data": {
                    schema: {
                      type: "object",
                      properties: { name: { type: "string" }, tag: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      calls,
    });

    await target.invoke({ argv: ["createItem", "--name", "example", "--tag", "test-service"] });

    const body = calls[0]?.init.body;
    expect(body).toBeInstanceOf(FormData);
    expect(Array.from((body as FormData).entries())).toEqual([
      ["name", "example"],
      ["tag", "test-service"],
    ]);
    expect(calls[0]?.init.headers ?? {}).toEqual({});
  });

  test("sends OpenAPI binary request bodies from base64 input", async () => {
    const calls: RequestCall[] = [];
    const target = createApiTarget({
      spec: {
        openapi: "3.0.0",
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/v1/uploads": {
            post: {
              operationId: "uploadItem",
              requestBody: {
                content: {
                  "application/octet-stream": {
                    schema: { type: "string", format: "binary" },
                  },
                },
              },
            },
          },
        },
      },
      calls,
    });

    await target.invoke({ argv: ["uploadItem", "--body-base64", "AQID"] });

    expect(calls[0]?.init.body).toEqual(Uint8Array.from([1, 2, 3]));
    expect(calls[0]?.init.headers).toEqual({ "content-type": "application/octet-stream" });
  });

  test("appends OpenAPI paths to baseUrl that carries its own path", async () => {
    const calls: RequestCall[] = [];
    const adapter = apiAdapter();
    const config = adapter.schema.parse({
      baseUrl: "https://slack.com/api",
      spec: {
        openapi: "3.0.0",
        servers: [{ url: "https://slack.com/api" }],
        paths: {
          "/search.messages": {
            get: { operationId: "search_messages" },
          },
        },
      },
    });
    const target = adapter.createTarget({
      manifest: { name: "slack-api", type: "api", config },
      config,
      context: {
        store: createMemoryGatewayStore(),
        services: {
          async fetch(input: string | URL | Request, init?: RequestInit) {
            calls.push({ input: String(input), init: init ?? {} });
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
          },
        },
      },
    });

    await target.invoke({ argv: ["search_messages"] });

    expect(calls[0]?.input).toBe("https://slack.com/api/search.messages");
  });

  test("returns binary API responses as base64 envelopes", async () => {
    const adapter = apiAdapter();
    const config = adapter.schema.parse({ baseUrl: "https://api.example.com" });
    const target = adapter.createTarget({
      manifest: { name: "notes-api", type: "api", config },
      config,
      context: {
        store: createMemoryGatewayStore(),
        services: {
          async fetch() {
            return new Response(Uint8Array.from([1, 2, 3]), {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/octet-stream" },
            });
          },
        },
      },
    });

    const result = await target.invoke({ argv: ["GET", "/v1/items/export"] });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        statusText: "OK",
        body: {
          contentType: "application/octet-stream",
          encoding: "base64",
          data: "AQID",
          size: 3,
        },
      },
      exitCode: 0,
    });
  });
});

type RequestCall = {
  input: string;
  init: RequestInit;
};

function createApiTarget(input: { spec: unknown; calls: RequestCall[] }) {
  const adapter = apiAdapter();
  const config = adapter.schema.parse({ spec: input.spec });
  return adapter.createTarget({
    manifest: { name: "notes-api", type: "api", config },
    config,
    context: {
      store: createMemoryGatewayStore(),
      services: {
        async fetch(requestInput: string | URL | Request, init?: RequestInit) {
          input.calls.push({ input: String(requestInput), init: init ?? {} });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  });
}
