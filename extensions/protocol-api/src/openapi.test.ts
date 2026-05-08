import { describe, expect, test } from "bun:test";
import { parseOpenApi } from "./openapi.ts";

describe("parseOpenApi / header parameters", () => {
  test("maps required OpenAPI header params into tool schema and header params", () => {
    const parsed = parseOpenApi({
      openapi: "3.0.3",
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/v1/cats": {
          get: {
            operationId: "list-cats",
            summary: "List cats",
            parameters: [
              {
                name: "X-Custom-Header",
                in: "header",
                required: true,
                description: "Custom header",
                schema: { type: "string" },
              },
              {
                name: "query",
                in: "query",
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });

    const tool = parsed.tools.find((t) => t.name === "list-cats");
    expect(tool).toBeDefined();
    expect(tool?.headerParams).toEqual(["X-Custom-Header"]);
    expect(tool?.queryParams).toEqual(["query"]);

    const schema = tool?.inputSchema as {
      properties: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    expect(schema.required).toContain("X-Custom-Header");
    expect(schema.properties["X-Custom-Header"]).toEqual({
      type: "string",
      description: "Custom header",
    });
  });
});
